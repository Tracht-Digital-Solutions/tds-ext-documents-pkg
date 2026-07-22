<?php
declare(strict_types=1);

namespace Tds\Ext\Documents;

use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\UploadedFileInterface;
use Slim\App;
use Slim\Psr7\Factory\StreamFactory;
use Tds\Ext\Documents\Domain\DocumentRepository;
use Tds\Ext\Documents\Service\DocumentSigner;
use Tds\Ext\Documents\Support\DocumentStorage;
use Tds\Frontend\Contract\AbstractModule;
use Tds\Frontend\Contract\PermissionDef;
use Tds\Frontend\Contract\UserContext;

/**
 * Backend Module for customer documents, ported from tds-customer-api's Document
 * actions (full parity incl. e-signing).
 *
 * Routes require `documents:read` (list/download/sign) or `documents:write`
 * (upload/rename); admins bypass. Company scope = `activeCompanyId()`. Bytes on
 * disk under DOCUMENT_ROOT_DIR ({@see DocumentStorage}); DB holds metadata.
 * Signed URLs (`GET /documents/sign`) verify an HMAC ({@see DocumentSigner},
 * DOCUMENT_SIGN_SECRET) instead of the JWT, so they work in <img>/new tabs.
 */
final class DocumentsModule extends AbstractModule
{
    public function id(): string
    {
        return 'documents';
    }

    /** @return PermissionDef[] */
    public function permissions(): array
    {
        return [
            new PermissionDef('documents:read', 'Dokumente ansehen', 'documents'),
            new PermissionDef('documents:write', 'Dokumente hochladen', 'documents'),
        ];
    }

    /** @return string[] */
    public function migrations(): array
    {
        return [__DIR__ . '/../db/migrations'];
    }

    public function register(App $app): void
    {
        $c = $app->getContainer();
        if ($c !== null && !$c->has(DocumentRepository::class)) {
            $c->set(DocumentRepository::class, static fn ($c) => new DocumentRepository($c->get(PDO::class)));
            $c->set(DocumentStorage::class, static fn () => new DocumentStorage());
        }

        // GET /documents/summary — count for the dashboard widget.
        $app->get('/documents/summary', function (Request $req, Response $res) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:read', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId() !== null ? (int) $user->activeCompanyId() : null;
            return self::json($res, ['count' => $c->get(DocumentRepository::class)->countForCustomer($cid)]);
        });

        // GET /documents?projectId= — list metadata.
        $app->get('/documents', function (Request $req, Response $res) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:read', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId();
            if ($cid === null) {
                return self::json($res, ['documents' => []]);
            }
            $pid = self::intParam($req->getQueryParams()['projectId'] ?? null);
            return self::json($res, ['documents' => $c->get(DocumentRepository::class)->listForCustomer((int) $cid, $pid)]);
        });

        // POST /documents — multipart upload under "file".
        $app->post('/documents', function (Request $req, Response $res) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:write', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId();
            if ($cid === null) {
                return self::json($res, ['error' => 'No active company'], 422);
            }
            $file = $req->getUploadedFiles()['file'] ?? null;
            if (!$file instanceof UploadedFileInterface || $file->getError() !== UPLOAD_ERR_OK) {
                return self::json($res, ['error' => 'No valid file uploaded under "file"'], 400);
            }
            if ($file->getSize() === null || $file->getSize() > DocumentStorage::MAX_BYTES) {
                return self::json($res, ['error' => 'File exceeds 25 MB limit'], 413);
            }
            $mime = $file->getClientMediaType() ?? 'application/octet-stream';
            if (!DocumentStorage::mimeAllowed($mime)) {
                return self::json($res, ['error' => 'Mime type not allowed', 'mime' => $mime], 415);
            }
            $storage = $c->get(DocumentStorage::class);
            if (!$storage->available()) {
                return self::json($res, ['error' => 'Document storage unavailable'], 503);
            }
            $meta = $storage->store((int) $cid, $file);
            $body = $req->getParsedBody();
            $pid = is_array($body) ? self::intParam($body['projectId'] ?? null) : null;
            $id = $c->get(DocumentRepository::class)->create((int) $cid, $pid, $meta);
            return self::json($res, ['id' => $id, 'filename' => $meta['filename']], 201);
        });

        // PATCH /documents/{id} — rename.
        $app->patch('/documents/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:write', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId();
            if ($cid === null) {
                return self::json($res, ['error' => 'No active company'], 422);
            }
            $body = $req->getParsedBody();
            $name = is_array($body) ? trim((string) ($body['filename'] ?? '')) : '';
            if ($name === '' || mb_strlen($name) > 255) {
                return self::json($res, ['error' => 'filename must be 1-255 chars'], 422);
            }
            $safe = preg_replace('/[^\p{L}\p{N}._ -]+/u', '_', $name) ?? $name;
            $ok = $c->get(DocumentRepository::class)->rename((int) $args['id'], (int) $cid, $safe);
            return $ok ? self::json($res, ['id' => (int) $args['id'], 'filename' => $safe]) : self::json($res, ['error' => 'Not found'], 404);
        });

        // GET /documents/{id}/download — JWT-gated stream.
        $app->get('/documents/{id:[0-9]+}/download', function (Request $req, Response $res, array $args) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:read', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId();
            if ($cid === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $doc = $c->get(DocumentRepository::class)->getForCustomer((int) $args['id'], (int) $cid);
            if ($doc === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            return self::stream($res, $c->get(DocumentStorage::class), $doc);
        });

        // POST /documents/{id}/sign — return a short-lived signed URL.
        $app->post('/documents/{id:[0-9]+}/sign', function (Request $req, Response $res, array $args) use ($c): Response {
            $user = $c->get(UserContext::class);
            if (($deny = self::require($user, 'documents:read', $res)) !== null) {
                return $deny;
            }
            $cid = $user->activeCompanyId();
            $signer = self::signer();
            if ($signer === null) {
                return self::json($res, ['error' => 'Signing unavailable'], 503);
            }
            if ($cid === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $doc = $c->get(DocumentRepository::class)->getForCustomer((int) $args['id'], (int) $cid);
            if ($doc === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $body = $req->getParsedBody();
            $ttlRaw = is_array($body) && isset($body['ttl']) ? (int) $body['ttl'] : DocumentSigner::DEFAULT_TTL;
            $ttl = max(30, min(3600, $ttlRaw));
            $exp = time() + $ttl;
            $sig = $signer->sign((int) $args['id'], (int) $cid, $exp);
            $base = self::baseUrl($req);
            $url = $base . '/documents/sign?' . http_build_query(['d' => (int) $args['id'], 'c' => (int) $cid, 'exp' => $exp, 'sig' => $sig]);
            return self::json($res, ['url' => $url, 'expiresAt' => date(DATE_ATOM, $exp)]);
        });

        // GET /documents/sign — HMAC-verified download (no JWT).
        $app->get('/documents/sign', function (Request $req, Response $res) use ($c): Response {
            $signer = self::signer();
            if ($signer === null) {
                return self::json($res, ['error' => 'Signing unavailable'], 503);
            }
            $q = $req->getQueryParams();
            $d = (int) ($q['d'] ?? 0);
            $cust = (int) ($q['c'] ?? 0);
            $exp = (int) ($q['exp'] ?? 0);
            $sig = (string) ($q['sig'] ?? '');
            if (!$signer->verify($d, $cust, $exp, $sig)) {
                return self::json($res, ['error' => 'Invalid or expired link'], 403);
            }
            $doc = $c->get(DocumentRepository::class)->get($d);
            if ($doc === null || (int) $doc['customer_id'] !== $cust) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            return self::stream($res, $c->get(DocumentStorage::class), $doc);
        });
    }

    /** @param array<string,mixed> $doc */
    private static function stream(Response $res, DocumentStorage $storage, array $doc): Response
    {
        $abs = $storage->absolutePath((string) $doc['storage_path']);
        if (!is_readable($abs)) {
            return self::json($res, ['error' => 'File no longer present on disk'], 410);
        }
        $stream = (new StreamFactory())->createStreamFromFile($abs, 'rb');
        return $res
            ->withHeader('Content-Type', (string) $doc['mime_type'])
            ->withHeader('Content-Length', (string) $doc['size_bytes'])
            ->withHeader('Content-Disposition', sprintf('attachment; filename="%s"', addslashes((string) $doc['filename'])))
            ->withBody($stream);
    }

    private static function signer(): ?DocumentSigner
    {
        $secret = (string) (getenv('DOCUMENT_SIGN_SECRET') ?: '');
        return $secret === '' ? null : new DocumentSigner($secret);
    }

    private static function baseUrl(Request $req): string
    {
        $uri = $req->getUri();
        $scheme = $uri->getScheme() !== '' ? $uri->getScheme() : 'https';
        $port = $uri->getPort();
        $authority = $uri->getHost() . ($port !== null && !in_array($port, [80, 443], true) ? ':' . $port : '');
        return $scheme . '://' . $authority;
    }

    private static function intParam(mixed $v): ?int
    {
        return $v !== null && ctype_digit((string) $v) ? (int) $v : null;
    }

    private static function require(UserContext $user, string $permission, Response $res): ?Response
    {
        if (!$user->isAuthenticated()) {
            return self::json($res, ['error' => 'Unauthorized'], 401);
        }
        if (!$user->has($permission)) {
            return self::json($res, ['error' => 'Forbidden'], 403);
        }
        return null;
    }

    private static function json(Response $res, mixed $data, int $status = 200): Response
    {
        $res->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR));
        return $res->withStatus($status)->withHeader('Content-Type', 'application/json');
    }
}
