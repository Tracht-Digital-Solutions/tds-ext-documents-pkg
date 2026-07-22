<?php
declare(strict_types=1);

namespace Tds\Ext\Documents\Tests;

use DI\Container;
use PHPUnit\Framework\TestCase;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ServerRequestFactory;
use Tds\Ext\Documents\DocumentsModule;
use Tds\Ext\Documents\Service\DocumentSigner;
use Tds\Frontend\Contract\UserContext;

/** A configurable UserContext double (no live JWT needed). */
final class FakeUser implements UserContext
{
    /** @param string[] $perms */
    public function __construct(
        private bool $auth = true,
        private bool $admin = false,
        private array $perms = [],
        private ?int $company = null,
        private ?int $uid = 1,
    ) {
    }

    public function isAuthenticated(): bool
    {
        return $this->auth;
    }

    public function userId(): ?int
    {
        return $this->uid;
    }

    public function email(): ?string
    {
        return null;
    }

    public function isAdmin(): bool
    {
        return $this->admin;
    }

    /** @return string[] */
    public function permissions(): array
    {
        return $this->perms;
    }

    public function has(string $permission): bool
    {
        return $this->admin || in_array($permission, $this->perms, true);
    }

    public function activeCompanyId(): ?int
    {
        return $this->company;
    }
}

/**
 * Route + RBAC + validation + signing coverage that needs no DB/disk: auth,
 * "no active company", and signed-link verification short-circuit before any
 * repository (PDO) or filesystem access.
 */
final class DocumentsModuleTest extends TestCase
{
    protected function setUp(): void
    {
        putenv('DOCUMENT_SIGN_SECRET');
    }

    protected function tearDown(): void
    {
        putenv('DOCUMENT_SIGN_SECRET');
    }

    private function appWith(UserContext $user): \Slim\App
    {
        $container = new Container();
        $container->set(UserContext::class, $user);
        AppFactory::setContainer($container);
        $app = AppFactory::create();
        $app->addBodyParsingMiddleware();
        $app->addRoutingMiddleware();
        (new DocumentsModule())->register($app);
        return $app;
    }

    private function get(\Slim\App $app, string $path): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle((new ServerRequestFactory())->createServerRequest('GET', $path));
    }

    /** @param array<string,mixed> $body */
    private function send(\Slim\App $app, string $method, string $path, array $body): \Psr\Http\Message\ResponseInterface
    {
        $req = (new ServerRequestFactory())->createServerRequest($method, $path)
            ->withHeader('Content-Type', 'application/json')
            ->withParsedBody($body);
        return $app->handle($req);
    }

    public function testMetadata(): void
    {
        $module = new DocumentsModule();
        self::assertSame('documents', $module->id());
        $ids = array_map(static fn ($p): string => $p->id, $module->permissions());
        self::assertSame(['documents:read', 'documents:write'], $ids);
        self::assertDirectoryExists($module->migrations()[0]);
    }

    public function testUnauthenticatedListUnauthorized(): void
    {
        self::assertSame(401, $this->get($this->appWith(new FakeUser(auth: false)), '/documents')->getStatusCode());
    }

    public function testReadWithoutPermissionForbidden(): void
    {
        self::assertSame(403, $this->get($this->appWith(new FakeUser(perms: [])), '/documents')->getStatusCode());
    }

    public function testReaderWithoutCompanyGetsEmptyList(): void
    {
        $res = $this->get($this->appWith(new FakeUser(perms: ['documents:read'], company: null)), '/documents');
        self::assertSame(200, $res->getStatusCode());
        self::assertSame(['documents' => []], json_decode((string) $res->getBody(), true));
    }

    public function testUploadRequiresWritePermission(): void
    {
        self::assertSame(403, $this->send($this->appWith(new FakeUser(perms: ['documents:read'])), 'POST', '/documents', [])->getStatusCode());
    }

    public function testUploadWithoutCompanyRejected(): void
    {
        self::assertSame(422, $this->send($this->appWith(new FakeUser(perms: ['documents:write'], company: null)), 'POST', '/documents', [])->getStatusCode());
    }

    public function testRenameRequiresWritePermission(): void
    {
        self::assertSame(403, $this->send($this->appWith(new FakeUser(perms: ['documents:read'])), 'PATCH', '/documents/1', ['filename' => 'x'])->getStatusCode());
    }

    public function testDownloadWithoutCompanyNotFound(): void
    {
        self::assertSame(404, $this->get($this->appWith(new FakeUser(perms: ['documents:read'], company: null)), '/documents/1/download')->getStatusCode());
    }

    public function testSignedDownloadUnavailableWithoutSecret(): void
    {
        self::assertSame(503, $this->get($this->appWith(new FakeUser(auth: false)), '/documents/sign?d=1&c=1&exp=9999999999&sig=x')->getStatusCode());
    }

    public function testSignedDownloadRejectsBadSignature(): void
    {
        putenv('DOCUMENT_SIGN_SECRET=test-secret');
        $res = $this->get($this->appWith(new FakeUser(auth: false)), '/documents/sign?d=1&c=1&exp=9999999999&sig=bad');
        self::assertSame(403, $res->getStatusCode());
    }

    public function testSignerRoundTrip(): void
    {
        $signer = new DocumentSigner('secret');
        $exp = time() + 300;
        self::assertTrue($signer->verify(5, 9, $exp, $signer->sign(5, 9, $exp)));
        self::assertFalse($signer->verify(5, 9, time() - 1, $signer->sign(5, 9, time() - 1)));
    }
}
