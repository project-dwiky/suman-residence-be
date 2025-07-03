# Gunakan image resmi Bun sebagai base
FROM oven/bun:latest as base

ARG API_SECRET_KEY

# Set direktori kerja
WORKDIR /app

# Salin package.json untuk menginstal dependensi
COPY package.json bun.lockb* bun.lock ./

# Instal dependensi
RUN bun install --frozen-lockfile

# Salin semua file ke direktori kerja
COPY . .

ENV API_SECRET_KEY=${API_SECRET_KEY}

# Buat direktori untuk menyimpan autentikasi WhatsApp
RUN mkdir -p whatsapp-auth && chmod 777 whatsapp-auth

# Ekspos port yang digunakan aplikasi
EXPOSE 8080

# Jalankan aplikasi
CMD ["bun", "run", "start"]
