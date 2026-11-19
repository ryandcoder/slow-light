<?php
declare(strict_types=1);

/**
 * A very small Supabase client (PostgREST + Storage) built on cURL,
 * so the Docker image needs no extra PHP extensions or Composer packages.
 */
final class Supabase
{
    private string $url;

    public function __construct(string $url, private string $key, private string $bucket)
    {
        $this->url = rtrim($url, '/');
    }

    private function authHeaders(): array
    {
        $headers = ['apikey: ' . $this->key];
        // Legacy JWT keys (service_role) are also sent as a Bearer token.
        // New-style sb_secret_... keys are not JWTs and must only go in "apikey".
        if (str_starts_with($this->key, 'eyJ')) {
            $headers[] = 'Authorization: Bearer ' . $this->key;
        }
        return $headers;
    }

    /** @return array{0:int,1:string} status code and raw body */
    private function call(string $method, string $path, ?string $body = null, array $headers = []): array
    {
        $ch = curl_init($this->url . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 60,
            CURLOPT_HTTPHEADER     => array_merge($this->authHeaders(), $headers),
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($ch);
        if ($response === false) {
            error_log('slow-light-api: supabase request failed: ' . curl_error($ch));
            curl_close($ch);
            throw new ApiError(502, 'The database could not be reached. Please try again in a moment.');
        }
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return [$status, (string) $response];
    }

    private function decode(int $status, string $body): array
    {
        if ($status >= 400) {
            error_log("slow-light-api: supabase returned $status: " . substr($body, 0, 500));
            throw new ApiError($status === 409 ? 409 : 502, 'The database refused that request.');
        }
        if ($body === '') {
            return [];
        }
        $data = json_decode($body, true);
        return is_array($data) ? $data : [];
    }

    /** @return list<array<string,mixed>> */
    public function select(string $table, string $query): array
    {
        [$status, $body] = $this->call('GET', "/rest/v1/$table?$query", null, ['Accept: application/json']);
        return $this->decode($status, $body);
    }

    /** @return array<string,mixed> the inserted row */
    public function insert(string $table, array $row): array
    {
        [$status, $body] = $this->call(
            'POST',
            "/rest/v1/$table",
            json_encode($row, JSON_UNESCAPED_UNICODE),
            ['Content-Type: application/json', 'Prefer: return=representation']
        );
        $rows = $this->decode($status, $body);
        return $rows[0] ?? [];
    }

    /** @return array<string,mixed> the updated row (empty when nothing matched) */
    public function update(string $table, string $query, array $row): array
    {
        [$status, $body] = $this->call(
            'PATCH',
            "/rest/v1/$table?$query",
            json_encode($row, JSON_UNESCAPED_UNICODE),
            ['Content-Type: application/json', 'Prefer: return=representation']
        );
        $rows = $this->decode($status, $body);
        return $rows[0] ?? [];
    }

    public function delete(string $table, string $query): void
    {
        [$status, $body] = $this->call('DELETE', "/rest/v1/$table?$query");
        $this->decode($status, $body);
    }

    public function upload(string $path, string $bytes, string $mime): void
    {
        $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));
        [$status, $body] = $this->call(
            'POST',
            "/storage/v1/object/{$this->bucket}/$encoded",
            $bytes,
            ['Content-Type: ' . $mime, 'x-upsert: true', 'Cache-Control: max-age=31536000']
        );
        $this->decode($status, $body);
    }

    /** @param list<string> $paths */
    public function removeObjects(array $paths): void
    {
        if (!$paths) {
            return;
        }
        [$status, $body] = $this->call(
            'DELETE',
            "/storage/v1/object/{$this->bucket}",
            json_encode(['prefixes' => array_values($paths)]),
            ['Content-Type: application/json']
        );
        $this->decode($status, $body);
    }
}
