<?php
declare(strict_types=1);

require __DIR__ . '/../src/helpers.php';
require __DIR__ . '/../src/Supabase.php';
require __DIR__ . '/../src/Images.php';
require __DIR__ . '/../src/handlers.php';

cors();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

try {
    if ($method === 'GET' && ($path === '/' || $path === '/health')) {
        json_out(200, ['name' => 'slow-light-api', 'ok' => true]);
    }
    if ($method === 'GET' && $path === '/api/ping') {
        ping();
    }

    // Visitors
    if ($method === 'POST' && preg_match("#^/api/photos/$uuid/comments$#", $path, $m)) {
        post_comment($m[1]);
    }
    if ($method === 'POST' && preg_match("#^/api/photos/$uuid/like$#", $path, $m)) {
        toggle_like($m[1]);
    }

    // Admin (needs the ADMIN_TOKEN)
    if ($method === 'GET' && $path === '/api/admin/check') {
        admin_check();
    }
    if ($method === 'POST' && $path === '/api/admin/photos') {
        upload_photo();
    }
    if ($method === 'PATCH' && preg_match("#^/api/admin/photos/$uuid$#", $path, $m)) {
        patch_photo($m[1]);
    }
    if ($method === 'DELETE' && preg_match("#^/api/admin/photos/$uuid$#", $path, $m)) {
        delete_photo($m[1]);
    }
    if ($method === 'DELETE' && preg_match("#^/api/admin/comments/$uuid$#", $path, $m)) {
        delete_comment($m[1]);
    }

    json_out(404, ['error' => 'Not found.']);
} catch (ApiError $e) {
    json_out($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('slow-light-api: ' . $e);
    json_out(500, ['error' => 'Something went wrong on the server.']);
}
