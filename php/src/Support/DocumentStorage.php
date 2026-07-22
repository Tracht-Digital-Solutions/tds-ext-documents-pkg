<?php
declare(strict_types=1);

namespace Tds\Ext\Documents\Support;

use Psr\Http\Message\UploadedFileInterface;

/**
 * Persists document bytes on disk under DOCUMENT_ROOT_DIR/{customer_id}/{uuid}-{name}
 * (ported from tds-customer-api's Document upload + AttachmentStorage). Same mime
 * allowlist + 25 MB cap. Only metadata goes in the DB.
 */
final class DocumentStorage
{
    public const ALLOWED_MIME = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
    ];
    public const MAX_BYTES = 25 * 1024 * 1024;

    public function rootDir(): string
    {
        return (string) (getenv('DOCUMENT_ROOT_DIR') ?: '');
    }

    public function available(): bool
    {
        $root = $this->rootDir();
        return $root !== '' && is_dir($root) && is_writable($root);
    }

    public static function mimeAllowed(string $mime): bool
    {
        return in_array($mime, self::ALLOWED_MIME, true);
    }

    /**
     * Store an uploaded file; returns its metadata.
     *
     * @return array{filename:string,storage_path:string,mime_type:string,size_bytes:int}
     */
    public function store(int $customerId, UploadedFileInterface $file): array
    {
        $mime = $file->getClientMediaType() ?? 'application/octet-stream';
        $root = $this->rootDir();
        $dir = $root . DIRECTORY_SEPARATOR . $customerId;
        if (!is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '_', (string) $file->getClientFilename()) ?: 'file';
        $uuid = bin2hex(random_bytes(8));
        $relPath = $customerId . '/' . $uuid . '-' . $safeName;
        $file->moveTo($root . DIRECTORY_SEPARATOR . $relPath);

        return [
            'filename' => $safeName,
            'storage_path' => $relPath,
            'mime_type' => $mime,
            'size_bytes' => (int) $file->getSize(),
        ];
    }

    public function absolutePath(string $storagePath): string
    {
        return $this->rootDir() . DIRECTORY_SEPARATOR . $storagePath;
    }
}
