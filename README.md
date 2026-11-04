# Smart Sport Center

Sistem monitoring ruang olahraga berbasis **ESP32** dengan dashboard web *real-time*. ESP32 membaca suhu, kelembapan, gerakan, dan akses pintu (RFID + sensor sentuh), mengirim datanya ke **Firebase Realtime Database**, lalu dashboard menampilkannya langsung di browser, baik di desktop maupun HP.

## Fitur

**Perangkat (ESP32)**
- Membaca suhu dan kelembapan ruangan dengan sensor DHT22.
- Kipas menyala otomatis saat suhu di atas 30 °C dan kelembapan di bawah 60 %.
- Lampu LED menyala saat sensor PIR mendeteksi gerakan, lalu mati 2 detik setelah gerakan berhenti.
- Pintu masuk dengan kartu RFID: hanya UID yang terdaftar yang diterima, kartu lain ditolak dan dicatat.
- Pintu keluar dengan sensor sentuh. Kedua pintu digerakkan servo dan menutup sendiri setelah 3 detik.
- Mengirim data ke Firebase setiap 3 detik, atau lebih cepat saat ada perubahan status.

**Dashboard web**
- Ringkasan suhu, kelembapan, total masuk, total keluar, dan pengunjung aktif.
- Grafik suhu dan kelembapan dari 60 pembacaan terakhir, lengkap dengan nilai sekarang, minimum, maksimum, dan rata-rata.
- Animasi kipas yang berputar mengikuti status kipas fisik.
- Indikator sensor PIR dan lampu LED.
- Riwayat 30 aktivitas terakhir, misalnya kartu diterima atau ditolak, akses keluar, gerakan, serta kipas dan lampu menyala atau mati.
- Status ESP32 online atau offline. ESP32 dianggap offline bila tidak ada pembaruan data selama 10 detik.
- Mode gelap dan terang, tampilan responsif (menu samping berubah menjadi bar bawah di HP), waktu dalam WIB.

> Dashboard bersifat **hanya-baca**: web menampilkan data, tidak mengontrol perangkat.

## Cara kerja

```
Sensor / RFID / Touch ──► ESP32 ──► Firebase Realtime Database ──► Dashboard web
                                    smartSportCenter/sensors
```

- **Pengunjung aktif** dihitung dari total masuk dikurangi total keluar.
- **Total masuk** bertambah setiap kartu RFID terdaftar ditempelkan. **Total keluar** bertambah setiap sensor sentuh ditekan.

## Komponen

| Komponen | Fungsi |
|---|---|
| ESP32 | Mikrokontroler utama dan koneksi Wi-Fi |
| DHT22 | Sensor suhu dan kelembapan |
| RFID RC522 | Akses pintu masuk |
| Sensor sentuh (touch) | Akses pintu keluar |
| Sensor PIR | Deteksi gerakan |
| Servo ×2 | Penggerak pintu masuk dan pintu keluar |
| Relay + kipas | Pendingin ruangan |
| LED | Lampu penerangan |

### Pin ESP32

| Komponen | Pin |
|---|---|
| DHT22 | GPIO 4 |
| RFID RC522 (SS / RST) | GPIO 5 / GPIO 22 |
| RFID RC522 (SCK / MISO / MOSI) | Pin SPI bawaan ESP32: 18 / 19 / 23 |
| Sensor PIR | GPIO 34 |
| Sensor sentuh | GPIO 33 |
| Relay kipas | GPIO 14 |
| LED | GPIO 2 |
| Servo 1 (pintu masuk) | GPIO 13 |
| Servo 2 (pintu keluar) | GPIO 27 |

## Penjelasan alat

Bagian ini menjelaskan fungsi tiap alat dan cara `PSK_26.ino` memakainya.

### ESP32
ESP32 adalah otak sistem dan menjalankan seluruh program. Saat menyala, ia menyiapkan semua pin dan sensor, tersambung ke Wi-Fi, lalu masuk ke Firebase secara anonim. Setelah itu `loop()` berjalan terus: membaca DHT22, PIR, sensor sentuh, dan RFID, menutup servo yang waktunya habis, membaca perintah dari Firebase tiap 1 detik, dan mengirim data tiap 3 detik atau saat ada perubahan. Pewaktuan memakai `millis()`, jadi tidak ada jeda panjang yang menahan program dan semua sensor tetap terbaca bersamaan.

### DHT22 (suhu dan kelembapan)
Sensor digital dengan satu kabel data ke GPIO 4. Dibaca setiap 2,5 detik, karena DHT22 tidak bisa dibaca lebih cepat dari sekitar tiap 2 detik. Jika pembacaan gagal, kode mencatat "Gagal membaca DHT22" di Serial Monitor dan tetap memakai nilai terakhir yang berhasil. Setiap pembacaan yang berhasil langsung dipakai untuk menentukan kipas.

### Relay dan kipas
Kipas tidak disambungkan langsung ke ESP32, tetapi lewat relay di GPIO 14, karena arus dan tegangan kipas lebih besar daripada yang aman untuk pin ESP32. Aturannya otomatis: kipas **menyala** bila suhu di atas 30 °C **dan** kelembapan di bawah 60 %, selain itu mati. Kedua syarat harus terpenuhi sekaligus. Relay hanya diganti dan data hanya dikirim saat status kipas berubah.

Dengan nilai bawaan `RELAY_ACTIVE_LOW = false`, kode menyalakan relay dengan sinyal LOW. Ini cocok untuk modul relay yang aktif saat sinyal LOW, seperti banyak modul relay murah. Nama konstantanya terbalik dari perilakunya, jadi jika kipas menyala saat seharusnya mati, ubah nilainya menjadi `true`.

### Sensor PIR (gerakan)
Sensor inframerah pasif yang mengeluarkan sinyal HIGH saat ada gerakan, dibaca di GPIO 34 (pin khusus input). Kode menahan status "ada gerakan" selama 2 detik setelah sinyal terakhir supaya tidak berkedip. Status ini dikirim ke dashboard dan menjadi pemicu lampu LED.

### LED (lampu penerangan)
Terhubung ke GPIO 2 dan selalu mengikuti status gerakan: menyala saat ada gerakan, mati 2 detik setelah gerakan berhenti. Di banyak board DevKit, GPIO 2 terhubung ke LED bawaan, sehingga LED itu ikut menyala.

### RFID RC522 (pintu masuk)
Pembaca kartu 13,56 MHz lewat SPI, dengan SS di GPIO 5 dan RST di GPIO 22. Alurnya:

1. Kartu didekatkan, lalu UID dibaca dan diubah menjadi heksadesimal huruf besar.
2. UID dicocokkan dengan daftar `UID_TERDAFTAR` (saat ini 2 kartu: ID 1 dan ID 2).
3. Jika terdaftar, `rfidCount` bertambah dan servo 1 membuka pintu masuk.
4. Jika tidak terdaftar, `deniedCount` bertambah, pintu tetap tertutup, dan penolakan muncul di riwayat dashboard.

Ada jeda 1,5 detik antar pembacaan supaya satu tempelan tidak terhitung berkali-kali. Perlu diketahui bahwa sistem hanya memeriksa UID kartu, bukan data di dalam kartu.

### Sensor sentuh (pintu keluar)
Modul sentuh digital yang mengeluarkan sinyal HIGH saat disentuh, dibaca dengan `digitalRead` di GPIO 33 (bukan fitur touch bawaan ESP32). Kode hanya menghitung saat sentuhan baru dimulai, dengan debounce 300 ms, jadi menahan tangan di sensor tidak menambah hitungan berkali-kali. Setiap sentuhan menambah `touchCount` dan membuka servo 2.

### Servo 1 dan Servo 2 (pintu)
Servo 1 di GPIO 13 untuk pintu masuk dan servo 2 di GPIO 27 untuk pintu keluar. Keduanya bekerja pada 50 Hz dengan lebar pulsa 500 sampai 2400 µs. Posisi tertutup 0° dan terbuka 90°. Pintu dibuka oleh RFID atau sensor sentuh, lalu menutup sendiri setelah 3 detik dengan pewaktu `millis()`, tanpa menahan program.

Servo juga bisa dibuka dari Firebase lewat `smartSportCenter/control` (`servo1` dan `servo2`), dan pintu yang dibuka dengan cara ini juga menutup otomatis setelah 3 detik. Dashboard ini belum mengirim perintah tersebut.

> Saran pemasangan, bukan dari kode: beri servo catu daya 5 V sendiri dan satukan GND-nya dengan ESP32, supaya ESP32 tidak reset saat servo bergerak.

### Ringkasan masukan dan keluaran

| Masukan | Kondisi | Keluaran |
|---|---|---|
| DHT22 | Suhu > 30 °C dan kelembapan < 60 % | Relay kipas menyala |
| Sensor PIR | Ada gerakan (ditahan 2 detik) | Lampu LED menyala |
| RFID | UID terdaftar | Servo 1 terbuka, total masuk bertambah |
| RFID | UID tidak terdaftar | Pintu tetap tertutup, penolakan dicatat |
| Sensor sentuh | Sentuhan baru | Servo 2 terbuka, total keluar bertambah |

## Struktur proyek

```
.
├── PSK_26.ino    # firmware ESP32
├── index.html    # halaman dashboard
├── style.css     # tampilan
├── script.js     # logika dashboard dan koneksi Firebase
└── README.md
```

## Cara memasang

### 1. Siapkan Firebase
1. Buat proyek di [Firebase Console](https://console.firebase.google.com/).
2. Aktifkan **Realtime Database**.
3. Aktifkan **Authentication → Sign-in method → Anonymous**. ESP32 dan dashboard sama-sama masuk secara anonim.
4. Atur *Rules* agar hanya pengguna yang sudah masuk yang bisa membaca dan menulis, misalnya:

```json
{
  "rules": {
    "smartSportCenter": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

### 2. Pasang firmware ESP32
1. Pasang ESP32 di Arduino IDE, lalu pasang pustaka berikut:
   - `Firebase ESP Client` (Mobizt)
   - `DHT sensor library` (Adafruit)
   - `MFRC522`
   - `ESP32Servo`
2. Buka `PSK_26.ino` dan isi bagian konfigurasi di atas file:
   - `WIFI_SSID` dan `WIFI_PASSWORD`
   - `API_KEY` dan `DATABASE_URL` dari proyek Firebase kamu
   - `UID_TERDAFTAR` dengan UID kartu RFID yang boleh masuk (huruf besar, tanpa spasi; UID kartu muncul di Serial Monitor saat ditempelkan)
3. Upload ke ESP32, lalu buka Serial Monitor (115200 baud) untuk melihat log.

### 3. Jalankan dashboard
1. Buka `script.js` dan isi `firebaseConfig` dengan konfigurasi web app dari proyek Firebase kamu.
2. Jalankan lewat server lokal, karena `script.js` memakai ES module yang tidak bisa dibuka langsung dari `file://`:

```bash
python -m http.server 8000
```

   Lalu buka `http://localhost:8000`. Bisa juga dengan ekstensi *Live Server* di VS Code, atau dipublikasikan lewat GitHub Pages atau Firebase Hosting.

## Struktur data Firebase

Firmware menulis ke `smartSportCenter/sensors`:

| Kunci | Isi |
|---|---|
| `temperature`, `humidity` | Suhu (°C) dan kelembapan (%) |
| `rfidCount`, `deniedCount` | Jumlah akses masuk diterima dan kartu ditolak |
| `touchCount` | Jumlah akses keluar |
| `motion` | Status gerakan dari PIR |
| `fan`, `led` | Status kipas dan lampu |
| `servo1`, `servo2` | Status pintu masuk dan pintu keluar |
| `lastRfid`, `lastRfidId` | UID kartu terakhir dan ID-nya (0 bila tidak terdaftar) |
| `updatedAt` | Penanda waktu, dipakai dashboard untuk mendeteksi ESP32 online atau offline |

Firmware juga membaca `smartSportCenter/control` (`servo1`, `servo2`) untuk membuka pintu dari jarak jauh. Dashboard ini belum memakai fitur tersebut.

## Pengaturan yang bisa diubah

Di `PSK_26.ino`:

| Konstanta | Fungsi | Bawaan |
|---|---|---|
| `SUHU_BATAS` | Batas suhu kipas menyala | 30 °C |
| `KELEMBAPAN_BATAS` | Batas kelembapan kipas menyala | 60 % |
| `SERVO_OPEN_DURATION_MS` | Lama pintu terbuka | 3000 ms |
| `PIR_OFF_DELAY_MS` | Jeda lampu mati setelah gerakan berhenti | 2000 ms |
| `SEND_INTERVAL_MS` | Interval kirim data berkala | 3000 ms |
| `RELAY_ACTIVE_LOW` | Polaritas relay. `false`: relay aktif saat pin LOW. `true`: relay aktif saat pin HIGH. Nama konstanta ini terbalik dari perilakunya | `false` |

Di `style.css`, ukuran tampilan desktop diatur lewat `html{font-size:85%}` pada blok `@media (min-width:1100px)`.

## Keamanan

Jangan unggah kata sandi Wi-Fi ke repositori publik. Ganti `WIFI_SSID` dan `WIFI_PASSWORD` di `PSK_26.ino` dengan nilai kosong atau contoh sebelum `git push`, atau simpan di file terpisah yang masuk `.gitignore`. Kunci Firebase untuk web memang tampil di sisi klien, jadi keamanan datanya bergantung pada *Rules* database di atas.

## Teknologi

ESP32 (Arduino), Firebase Realtime Database, HTML, CSS, JavaScript (Firebase JS SDK 10), font Poppins dan JetBrains Mono.
