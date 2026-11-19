<?php
declare(strict_types=1);

const CHAPTERS = ['cover', 'strip', 'sheet'];

function ensure_photo(string $id): void
{
    if (!sb()->select('photos', 'select=id&id=eq.' . $id . '&limit=1')) {
        throw new ApiError(404, 'That photo no longer exists.');
    }
}

/* ------------------------------------------------------------ public */

function ping(): never
{
    sb()->select('photos', 'select=id&limit=1'); // also keeps a free Supabase project awake
    json_out(200, ['ok' => true]);
}

function post_comment(string $photoId): never
{
    $in = body_json();

    // Hidden "website" field: real people leave it empty, bots fill it in.
    if (trim((string) ($in['website'] ?? '')) !== '') {
        json_out(200, ['ok' => true, 'comment' => null]);
    }

    $name = clean_text($in['name'] ?? '', 40);
    $body = clean_text($in['body'] ?? '', 500, true);
    if ($name === '') {
        throw new ApiError(422, 'Please add your name.');
    }
    if ($body === '') {
        throw new ApiError(422, 'Please write a comment.');
    }
    if (substr_count(strtolower($body), 'http') > 2) {
        throw new ApiError(422, 'Please keep links to a minimum.');
    }

    ensure_photo($photoId);
    $ip = ip_hash();
    rate_limit('comments', $ip, 3, 60);
    rate_limit('comments', $ip, 30, 3600);

    $row = sb()->insert('comments', [
        'photo_id' => $photoId,
        'name'     => $name,
        'body'     => $body,
        'ip_hash'  => $ip,
    ]);

    json_out(201, ['ok' => true, 'comment' => [
        'id'         => $row['id'] ?? null,
        'name'       => $name,
        'body'       => $body,
        'created_at' => $row['created_at'] ?? gmdate('c'),
    ]]);
}

function toggle_like(string $photoId): never
{
    $in = body_json();
    $visitor = (string) ($in['visitor'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $visitor)) {
        throw new ApiError(422, 'Missing visitor id.');
    }

    ensure_photo($photoId);
    $match = 'photo_id=eq.' . $photoId . '&visitor_id=eq.' . rawurlencode($visitor);

    if (sb()->select('likes', 'select=photo_id&' . $match . '&limit=1')) {
        sb()->delete('likes', $match);
        $liked = false;
    } else {
        rate_limit('likes', ip_hash(), 100, 3600);
        try {
            sb()->insert('likes', [
                'photo_id'   => $photoId,
                'visitor_id' => $visitor,
                'ip_hash'    => ip_hash(),
            ]);
        } catch (ApiError $e) {
            if ($e->status !== 409) { // 409 = already liked in a parallel request
                throw $e;
            }
        }
        $liked = true;
    }

    $photo = sb()->select('photos', 'select=likes_count&id=eq.' . $photoId);
    json_out(200, ['liked' => $liked, 'likes' => (int) ($photo[0]['likes_count'] ?? 0)]);
}

/* ------------------------------------------------------------- admin */

function admin_check(): never
{
    require_admin();
    json_out(200, ['ok' => true]);
}

function upload_photo(): never
{
    require_admin();

    $file = $_FILES['file'] ?? null;
    if (!is_array($file)) {
        throw new ApiError(400, 'No photo was received.');
    }
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $tooBig = in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        throw new ApiError($tooBig ? 413 : 400, $tooBig ? 'Photos can be up to 20 MB.' : 'The upload did not finish. Please try again.');
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        throw new ApiError(400, 'No photo was received.');
    }

    $chapter = (string) ($_POST['chapter'] ?? 'sheet');
    if (!in_array($chapter, CHAPTERS, true)) {
        $chapter = 'sheet';
    }
    $title = clean_text($_POST['title'] ?? '', 120);
    $caption = clean_text($_POST['caption'] ?? '', 500, true);

    $processed = Images::process($file['tmp_name']);

    $id = uuid4();
    $folder = gmdate('Y/m');
    $imagePath = "$folder/$id.webp";
    $thumbPath = "$folder/$id-thumb.webp";

    sb()->upload($imagePath, $processed['full'], 'image/webp');
    sb()->upload($thumbPath, $processed['thumb'], 'image/webp');

    try {
        $row = sb()->insert('photos', [
            'title'      => $title,
            'caption'    => $caption,
            'chapter'    => $chapter,
            'image_path' => $imagePath,
            'thumb_path' => $thumbPath,
            'width'      => $processed['width'],
            'height'     => $processed['height'],
        ]);
    } catch (Throwable $e) {
        try { sb()->removeObjects([$imagePath, $thumbPath]); } catch (Throwable) {}
        throw $e;
    }

    json_out(201, ['ok' => true, 'photo' => $row]);
}

function patch_photo(string $id): never
{
    require_admin();
    $in = body_json();
    $fields = [];

    if (array_key_exists('title', $in)) {
        $fields['title'] = clean_text($in['title'], 120);
    }
    if (array_key_exists('caption', $in)) {
        $fields['caption'] = clean_text($in['caption'], 500, true);
    }
    if (array_key_exists('chapter', $in)) {
        if (!in_array($in['chapter'], CHAPTERS, true)) {
            throw new ApiError(422, 'Chapter must be cover, strip or sheet.');
        }
        $fields['chapter'] = $in['chapter'];
    }
    if (array_key_exists('position', $in)) {
        $fields['position'] = max(-9999, min(9999, (int) $in['position']));
    }
    if (!$fields) {
        throw new ApiError(422, 'Nothing to change.');
    }

    $row = sb()->update('photos', 'id=eq.' . $id, $fields);
    if (!$row) {
        throw new ApiError(404, 'That photo no longer exists.');
    }
    json_out(200, ['ok' => true, 'photo' => $row]);
}

function delete_photo(string $id): never
{
    require_admin();
    $rows = sb()->select('photos', 'select=image_path,thumb_path&id=eq.' . $id . '&limit=1');
    if (!$rows) {
        throw new ApiError(404, 'That photo no longer exists.');
    }

    sb()->delete('photos', 'id=eq.' . $id); // comments and likes go with it
    try {
        sb()->removeObjects([$rows[0]['image_path'], $rows[0]['thumb_path']]);
    } catch (Throwable $e) {
        error_log('slow-light-api: could not remove files for photo ' . $id . ': ' . $e->getMessage());
    }
    json_out(200, ['ok' => true]);
}

function delete_comment(string $id): never
{
    require_admin();
    sb()->delete('comments', 'id=eq.' . $id);
    json_out(200, ['ok' => true]);
}
