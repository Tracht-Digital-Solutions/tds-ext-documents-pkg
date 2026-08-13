<?php
/**
 * API documentation for this module's routes — consumed through `ApiDocSource`
 * and rendered in the admin frontend's API reference (`GET /wiki.json`).
 *
 * `pattern` must match the Slim pattern in `register()` VERBATIM, inline regex
 * included: it is the join key for the route introspection.
 * `php/tests/DocumentsApiDocsTest.php` fails the build if the documented set and
 * the registered set drift apart in either direction.
 */

declare(strict_types=1);

return [
    [
        'method' => 'GET',
        'pattern' => '/documents/summary',
        'summary' => 'Anzahl der Dokumente der aktiven Firma',
        'description' => 'Die `dataEndpoint`-Route des Dashboard-Widgets.',
        'permission' => 'documents:read',
        'responses' => [
            ['status' => 200, 'description' => '`{count: <Anzahl>}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/documents',
        'summary' => 'Dokumente der aktiven Firma auflisten (nur Metadaten)',
        'description' => 'Ohne aktive Firma (`X-Act-As-Customer`) wird eine **leere Liste** '
            . 'geliefert, kein Fehler: das ist der normale Zustand eines Admins, der '
            . 'noch keine Firma ausgewählt hat.',
        'permission' => 'documents:read',
        'params' => [
            ['in' => 'query', 'name' => 'projectId', 'type' => 'int', 'description' => 'Auf ein Projekt einschränken. Nicht-numerische Werte werden ignoriert.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{documents: [{id, filename, mime, size, project_id, created_at}]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/documents',
        'summary' => 'Dokument hochladen (multipart)',
        'description' => 'Die Datei kommt als Multipart-Feld **`file`**, nicht als JSON. '
            . 'Drei getrennte Ablehnungsgründe mit eigenen Statuscodes, damit die '
            . 'Oberfläche sagen kann, was zu tun ist: zu groß (413), Dateityp nicht '
            . 'erlaubt (415), Ablage nicht verfügbar (503).',
        'permission' => 'documents:write',
        'params' => [
            ['in' => 'body', 'name' => 'file', 'type' => 'multipart', 'required' => true, 'description' => 'Die Datei. Höchstens 25 MB, Mime-Typ muss auf der Positivliste stehen.'],
            ['in' => 'body', 'name' => 'projectId', 'type' => 'int', 'description' => 'Dokument einem Projekt zuordnen.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id, filename}`'],
            ['status' => 400, 'description' => 'Kein gültiges Feld `file` im Upload.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:write`.'],
            ['status' => 413, 'description' => 'Datei größer als 25 MB.'],
            ['status' => 415, 'description' => 'Mime-Typ nicht erlaubt — der abgelehnte Typ steht in der Antwort.'],
            ['status' => 422, 'description' => 'Keine aktive Firma.'],
            ['status' => 503, 'description' => 'Dokumentenablage nicht verfügbar (kein beschreibbares Verzeichnis).'],
        ],
    ],
    [
        'method' => 'PATCH',
        'pattern' => '/documents/{id:[0-9]+}',
        'summary' => 'Dokument umbenennen',
        'description' => 'Der Name wird bereinigt: alles außer Buchstaben, Ziffern, Punkt, '
            . 'Unterstrich, Leerzeichen und Bindestrich wird durch `_` ersetzt. Der '
            . 'tatsächlich gespeicherte Name steht in der Antwort — er kann vom '
            . 'gesendeten abweichen.',
        'permission' => 'documents:write',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Dokuments.'],
            ['in' => 'body', 'name' => 'filename', 'type' => 'string', 'required' => true, 'description' => '1 bis 255 Zeichen.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{id, filename}` — der bereinigte Name.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:write`.'],
            ['status' => 404, 'description' => 'Dokument gehört nicht zur aktiven Firma oder existiert nicht.'],
            ['status' => 422, 'description' => 'Keine aktive Firma, oder Name leer bzw. länger als 255 Zeichen.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/documents/{id:[0-9]+}/download',
        'summary' => 'Dokument herunterladen (Sitzung erforderlich)',
        'description' => 'Streamt die Datei. Der Zugriff ist auf die aktive Firma begrenzt; '
            . 'ein fremdes Dokument ergibt 404 statt 403, damit die Existenz nicht '
            . 'preisgegeben wird.',
        'permission' => 'documents:read',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Dokuments.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => 'Die Datei als Byte-Stream mit ihrem Mime-Typ.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:read`.'],
            ['status' => 404, 'description' => 'Unbekannt oder nicht in der aktiven Firma.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/documents/{id:[0-9]+}/sign',
        'summary' => 'Kurzlebigen, signierten Download-Link erzeugen',
        'description' => 'Für Fälle, in denen die Datei ohne Sitzung erreichbar sein muss '
            . '(E-Mail-Anhang-Ersatz, externer Betrachter). Der Link ist HMAC-signiert '
            . 'und trägt sein Ablaufdatum in sich — er wird nirgends gespeichert und '
            . 'kann daher auch nicht zurückgezogen werden. Die Gültigkeitsdauer wird '
            . 'auf 30 bis 3600 Sekunden begrenzt.',
        'permission' => 'documents:read',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Dokuments.'],
            ['in' => 'body', 'name' => 'ttl', 'type' => 'int', 'description' => 'Gültigkeit in Sekunden, auf 30…3600 begrenzt.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{url, expiresAt}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `documents:read`.'],
            ['status' => 404, 'description' => 'Unbekannt oder nicht in der aktiven Firma.'],
            ['status' => 503, 'description' => 'Kein Signaturschlüssel konfiguriert.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/documents/sign',
        'summary' => 'Download über einen signierten Link (ohne Sitzung)',
        'description' => 'Die Gegenstelle zu `POST /documents/{id}/sign`. Es wird **kein** '
            . 'JWT geprüft — die Signatur ist der Nachweis. Sie deckt Dokument-Id, '
            . 'Firmen-Id und Ablaufzeitpunkt ab, sodass keiner der Parameter einzeln '
            . 'verändert werden kann.',
        'auth' => 'token',
        'params' => [
            ['in' => 'query', 'name' => 'd', 'type' => 'int', 'required' => true, 'description' => 'Dokument-Id.'],
            ['in' => 'query', 'name' => 'c', 'type' => 'int', 'required' => true, 'description' => 'Firmen-Id.'],
            ['in' => 'query', 'name' => 'exp', 'type' => 'int', 'required' => true, 'description' => 'Ablauf als Unix-Zeit.'],
            ['in' => 'query', 'name' => 'sig', 'type' => 'string', 'required' => true, 'description' => 'HMAC über die drei Werte.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => 'Die Datei als Byte-Stream.'],
            ['status' => 403, 'description' => 'Signatur ungültig oder Link abgelaufen.'],
            ['status' => 404, 'description' => 'Dokument existiert nicht oder gehört nicht zur signierten Firma.'],
            ['status' => 503, 'description' => 'Kein Signaturschlüssel konfiguriert.'],
        ],
    ],
];
