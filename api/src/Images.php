<?php
declare(strict_types=1);

/** Turns an uploaded photo into a web-sized WebP plus a small thumbnail. */
final class Images
{
    public const MAX_BYTES = 20 * 1024 * 1024;
    private const FULL_EDGE = 1800;
    private const THUMB_EDGE = 640;

    /** @return array{full:string,thumb:string,width:int,height:int} */
    public static function process(string $tmpFile): array
    {
        $size = filesize($tmpFile);
        if ($size === false || $size === 0 || $size > self::MAX_BYTES) {
            throw new ApiError(413, 'Photos can be up to 20 MB.');
        }

        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmpFile);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new ApiError(415, 'Please upload a JPEG, PNG or WebP photo.');
        }

        $data = file_get_contents($tmpFile);
        $image = $data === false ? false : @imagecreatefromstring($data);
        unset($data);
        if ($image === false) {
            throw new ApiError(415, 'That file could not be read as an image.');
        }
        if (!imageistruecolor($image)) {
            imagepalettetotruecolor($image);
        }

        if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
            $exif = @exif_read_data($tmpFile);
            $orientation = (int) ($exif['Orientation'] ?? 1);
            $angle = [3 => 180, 6 => -90, 8 => 90][$orientation] ?? 0;
            if ($angle !== 0) {
                $rotated = imagerotate($image, $angle, 0);
                if ($rotated !== false) {
                    $image = $rotated;
                }
            }
        }

        $full = self::scaled($image, self::FULL_EDGE);
        $thumb = self::scaled($image, self::THUMB_EDGE);

        return [
            'full'   => self::webp($full, 82),
            'thumb'  => self::webp($thumb, 78),
            'width'  => imagesx($full),
            'height' => imagesy($full),
        ];
    }

    private static function scaled(GdImage $src, int $maxEdge): GdImage
    {
        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min(1.0, $maxEdge / max($w, $h));
        if ($scale >= 1.0) {
            return $src;
        }
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        return $dst;
    }

    private static function webp(GdImage $image, int $quality): string
    {
        ob_start();
        imagewebp($image, null, $quality);
        return (string) ob_get_clean();
    }
}
