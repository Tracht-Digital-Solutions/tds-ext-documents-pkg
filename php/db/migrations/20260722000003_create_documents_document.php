<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Documents (ported from tds-customer-api's `document`). This extension owns its
 * own DB: customer_id / project_id carry NO foreign key — those entities live in
 * another domain. customer_id = the JWT active company id. Bytes live on disk
 * under DOCUMENT_ROOT_DIR/{customer_id}/{uuid}-{name}; only metadata is in the DB.
 * MySQL-8-safe.
 *
 * Class name AND numeric prefix are extension-unique (shared phinxlog rule).
 */
final class CreateDocumentsDocument extends AbstractMigration
{
    public function change(): void
    {
        $this->table('documents_document', [
            'id' => true,
            'engine' => 'InnoDB',
            'collation' => 'utf8mb4_unicode_ci',
        ])
            ->addColumn('customer_id', 'integer', ['signed' => false])
            ->addColumn('project_id', 'integer', ['null' => true, 'signed' => false])
            ->addColumn('filename', 'string', ['limit' => 255])
            ->addColumn('storage_path', 'string', ['limit' => 500])
            ->addColumn('mime_type', 'string', ['limit' => 100])
            ->addColumn('size_bytes', 'biginteger')
            ->addColumn('uploaded_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['customer_id', 'uploaded_at'], ['name' => 'idx_documents_customer_uploaded'])
            ->addIndex(['project_id'], ['name' => 'idx_documents_project'])
            ->create();
    }
}
