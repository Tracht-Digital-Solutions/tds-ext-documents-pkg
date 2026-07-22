<?php
declare(strict_types=1);

namespace Tds\Ext\Documents\Domain;

use PDO;

/**
 * Metadata access for documents (bytes live on disk). Ported from
 * tds-customer-api's Document actions. `customer_id` is the JWT active company
 * id (no FK); reads/writes are company-scoped.
 */
final class DocumentRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    private const COLS = 'id, customer_id, project_id, filename, mime_type, size_bytes, uploaded_at';

    /** @return array<int,array<string,mixed>> */
    public function listForCustomer(int $customerId, ?int $projectId): array
    {
        $sql = 'SELECT ' . self::COLS . ' FROM documents_document WHERE customer_id = :cid';
        $params = ['cid' => $customerId];
        if ($projectId !== null) {
            $sql .= ' AND project_id = :pid';
            $params['pid'] = $projectId;
        }
        $sql .= ' ORDER BY uploaded_at DESC, id DESC';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** @return array<string,mixed>|null Full row incl. storage_path (for download). */
    public function getForCustomer(int $id, int $customerId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, customer_id, project_id, filename, storage_path, mime_type, size_bytes, uploaded_at '
            . 'FROM documents_document WHERE id = :id AND customer_id = :cid LIMIT 1'
        );
        $stmt->execute(['id' => $id, 'cid' => $customerId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /** @return array<string,mixed>|null Full row without company scope (signed-URL download). */
    public function get(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, customer_id, filename, storage_path, mime_type, size_bytes '
            . 'FROM documents_document WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /** @param array{filename:string,storage_path:string,mime_type:string,size_bytes:int} $meta */
    public function create(int $customerId, ?int $projectId, array $meta): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO documents_document (customer_id, project_id, filename, storage_path, mime_type, size_bytes, uploaded_at) '
            . 'VALUES (:cid, :pid, :fn, :sp, :mt, :sb, NOW())'
        );
        $stmt->execute([
            'cid' => $customerId,
            'pid' => $projectId,
            'fn' => $meta['filename'],
            'sp' => $meta['storage_path'],
            'mt' => $meta['mime_type'],
            'sb' => $meta['size_bytes'],
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function rename(int $id, int $customerId, string $filename): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE documents_document SET filename = :fn WHERE id = :id AND customer_id = :cid'
        );
        $stmt->execute(['fn' => $filename, 'id' => $id, 'cid' => $customerId]);
        return $stmt->rowCount() > 0;
    }

    public function countForCustomer(?int $customerId): int
    {
        $sql = 'SELECT COUNT(*) FROM documents_document';
        $params = [];
        if ($customerId !== null) {
            $sql .= ' WHERE customer_id = :cid';
            $params['cid'] = $customerId;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }
}
