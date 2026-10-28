# Cursed Era: Shinjuku Showdown — Online

## Yerelde çalıştırma
1. Node.js 18+ kur.
2. Bu klasörde: `npm install` sonra `npm start`
3. Tarayıcıda `http://localhost:3000` aç. Aynı Wi-Fi'deki başka cihaz: `http://BILGISAYAR_IP:3000`
4. Ana menü → ONLINE 1v1 → ODA OLUŞTUR; diğer oyuncu kodu girip KATIL der. RASTGELE RAKİP bekleyen biriyle eşleştirir.

`localhost` farklı ağlardaki kişiler için çalışmaz. İnternetten oynamak için sunucuyu barındırman gerekir.

## İnternette yayınlama (Render, Railway, Fly.io vb.)
1. Klasörü GitHub'a yükle.
2. Render: New → Web Service → repoyu seç. Build: `npm install`, Start: `npm start`. (Node sunucusu olduğu için Static Site değil Web Service seç.)
3. Verilen `https://....onrender.com` adresini iki oyuncu da açar. HTTPS/WSS otomatik çalışır, PORT ortam değişkeni sunucuda okunur.
4. Oyun dosyasını başka yerden açacaksan (ör. kendi sitenden), ONLINE menüsündeki "Sunucu adresi" alanına bu adresi yaz.

## Mimari
- Sunucu odaları, eşleştirmeyi, canı, round/skoru ve iyileşme bekleme süresini yönetir. İstemci yalnızca "vurdum" bildirir; sunucu menzil, hız ve hasar sınırını kontrol edip canı kendisi düşürür.
- Konum ve görsel eylemler (yumruk, yetenek, domain) rakibe aktarılır.
