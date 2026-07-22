<?php
declare(strict_types=1);

namespace Tds\Ext\Documents\Service;

/**
 * HMAC signer for short-lived document URLs (ported from tds-customer-api).
 *
 * Signs the tuple (documentId, customerId, exp) so a signed URL can be handed to
 * the frontend (or pasted into an <img>) without re-authenticating on every byte
 * fetch. Verify checks the HMAC is intact and the URL hasn't expired. The secret
 * comes from DOCUMENT_SIGN_SECRET; an empty secret disables signing (the module
 * returns 503 rather than constructing this).
 */
final class DocumentSigner
{
    public const DEFAULT_TTL = 300; // 5 minutes

    public function __construct(private readonly string $secret)
    {
        if ($this->secret === '') {
            throw new \InvalidArgumentException('DOCUMENT_SIGN_SECRET is empty — set a strong random string');
        }
    }

    public function sign(int $documentId, int $customerId, int $exp): string
    {
        return hash_hmac('sha256', sprintf('%d.%d.%d', $documentId, $customerId, $exp), $this->secret);
    }

    /** Constant-time verify; true only when the signature matches AND exp is in the future. */
    public function verify(int $documentId, int $customerId, int $exp, string $sig): bool
    {
        if ($exp <= time()) {
            return false;
        }
        return hash_equals($this->sign($documentId, $customerId, $exp), $sig);
    }
}
