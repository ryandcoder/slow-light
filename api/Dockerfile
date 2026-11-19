# Slow Light API: PHP 8.3 + Apache, ready for Render (or any Docker host).
FROM php:8.3-apache

# Image tools used to resize uploads (GD with JPEG + WebP, EXIF for phone rotation).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libjpeg-dev libpng-dev libwebp-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" gd exif \
    && rm -rf /var/lib/apt/lists/*

# Serve from public/ and send every unknown path to index.php.
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

COPY apache.conf /etc/apache2/conf-available/slow-light.conf
COPY php.ini /usr/local/etc/php/conf.d/slow-light.ini
RUN a2enconf slow-light

COPY src /var/www/html/src
COPY public /var/www/html/public

# Render tells the container which port to listen on through $PORT.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 10000
CMD ["/usr/local/bin/entrypoint.sh"]
