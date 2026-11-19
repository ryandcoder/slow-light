<?php
declare(strict_types=1);

/** An error that is safe to show to the visitor. */
final class ApiError extends RuntimeException
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

function env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if ($value === false) {
        $value = $_SERVER[$key] ?? $_ENV[$key] ?? false;
    }
    if ($value === false || $value === '') {
        return $default;
    }
    return (string) $value;
}

function required_env(string $key): string
{
    $value = env($key);
    if ($value === null) {
        error_log("slow-light-api: missing environment variable $key");
        throw new ApiError(500, 'The server is not configured yet.');
    }
    return $value;
}

function sb(): Supabase
{
    static $client = null;
    return $client ??= new Supabase(
        required_env('SUPABASE_URL'),
        required_env('SUPABASE_SERVICE_KEY'),
        env('STORAGE_BUCKET', 'photos')
    );
}

function json_out(int $status, array $data): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cors(): void
{
    $origin = rtrim($_SERVER['HTTP_ORIGIN'] ?? '', '/');
    $allowed = array_values(array_filter(array_map(
        static fn(string $o): string => rtrim(trim($o), '/'),
        explode(',', env('ALLOWED_ORIGINS', '*'))
    )));

    if ($origin !== '') {
        if (in_array('*', $allowed, true)) {
            header('Access-Control-Allow-Origin: *');
        } elseif (in_array($origin, $allowed, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
        }
    }
    header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 86400');
}

function body_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    if (strlen($raw) > 20000) {
        throw new ApiError(413, 'That request is too large.');
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Trim, strip control characters and cap the length. */
function clean_text(mixed $value, int $max, bool $multiline = false): string
{
    $text = is_scalar($value) ? (string) $value : '';
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text) ?? '';
    if (!$multiline) {
        $text = preg_replace('/\s+/u', ' ', $text) ?? '';
    } else {
        $text = preg_replace("/\r\n?/", "\n", $text) ?? '';
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? '';
    }
    return mb_substr(trim($text), 0, $max);
}

/** A salted hash of the visitor's IP, used only for rate limiting. */
function ip_hash(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    $ip = trim(explode(',', $forwarded)[0]);
    if ($ip === '') {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
    return hash('sha256', (env('IP_SALT', 'slow-light') ?? '') . '|' . $ip);
}

/** Refuse when this visitor already did $max things in the last $seconds. */
function rate_limit(string $table, string $ipHash, int $max, int $seconds): void
{
    $since = gmdate('Y-m-d\TH:i:s\Z', time() - $seconds);
    $rows = sb()->select(
        $table,
        'select=created_at&ip_hash=eq.' . rawurlencode($ipHash)
        . '&created_at=gte.' . rawurlencode($since)
        . '&limit=' . $max
    );
    if (count($rows) >= $max) {
        throw new ApiError(429, 'Easy there. Please wait a moment and try again.');
    }
}

function require_admin(): void
{
    $token = env('ADMIN_TOKEN');
    if ($token === null || strlen($token) < 16) {
        throw new ApiError(503, 'Admin is switched off until ADMIN_TOKEN (16+ characters) is set on the server.');
    }

    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string) $name, 'Authorization') === 0) {
                $auth = (string) $value;
            }
        }
    }
    $given = preg_match('/^Bearer\s+(.+)$/i', $auth, $m) ? trim($m[1]) : '';

    if (!hash_equals($token, $given)) {
        usleep(600000); // slow down guessing
        throw new ApiError(401, 'That admin token is not right.');
    }
}

function uuid4(): string
{
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
