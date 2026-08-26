const http = require('http');

// БАЗЫ ДАННЫХ
let savedItems = [];
let savedMessages = [];
let savedReviews = [];
let onlineUsers = [];

// ============================================================
// АДМИНИСТРАТОР
// ============================================================
const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'admin123';

// ============================================================
// КИБЕР-МОДЕРАЦИЯ
// ============================================================
const stopWords = ['скам', 'оружие', 'нарко', 'взрывчатка', 'продам мать', 'чит', 'hack', 'дурак', 'лохотрон', 'развод', 'кидала', 'обман', 'мошенник'];

function containsForbiddenWords(text) {
    var lowerText = text.toLowerCase();
    for (var i = 0; i < stopWords.length; i++) {
        if (lowerText.includes(stopWords[i])) return true;
    }
    return false;
}

function isValidImei(imei) {
    return /^[0-9]{15}$/.test(imei);
}

var server = http.createServer(function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // SSE
    if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        onlineUsers.push(res);
        req.on('close', function() {
            onlineUsers = onlineUsers.filter(function(user) { return user !== res; });
        });
        return;
    }

    // GET /get-items
    if (req.method === 'GET' && req.url === '/get-items') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedItems));
        return;
    }

    // GET /get-reviews
    if (req.method === 'GET' && req.url === '/get-reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedReviews));
        return;
    }

    // POST /add-review (с проверкой на дубли)
    if (req.method === 'POST' && req.url === '/add-review') {
        var body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', function() {
            try {
                var reviewData = JSON.parse(body);

                if (!reviewData.from || reviewData.from === 'Гость') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '❌ Только зарегистрированные могут оставлять отзывы!' }));
                    return;
                }

                // Нельзя оставить отзыв самому себе
                if (reviewData.from === reviewData.seller) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '❌ Нельзя оставить отзыв самому себе!' }));
                    return;
                }

                // Проверка: уже есть отзыв от этого пользователя этому продавцу
                var alreadyExists = savedReviews.some(function(r) {
                    return r.from === reviewData.from && r.seller === reviewData.seller;
                });
                if (alreadyExists) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '❌ Вы уже оставляли отзыв этому продавцу!' }));
                    return;
                }

                reviewData.id = 'review_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                savedReviews.push(reviewData);
                console.log('⭐ ' + reviewData.from + ' оставил отзыв для ' + reviewData.seller + ': ' + reviewData.rating + '⭐');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', id: reviewData.id }));
            } catch (err) {
                res.writeHead(400);
                res.end();
            }
        });
        return;
    }

    // DELETE /delete-review/:id
    if (req.method === 'DELETE' && req.url.startsWith('/delete-review/')) {
        var reviewId = req.url.split('/').pop();
        var index = -1;
        for (var i = 0; i < savedReviews.length; i++) {
            if (savedReviews[i].id === reviewId) { index = i; break; }
        }
        if (index === -1) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Отзыв не найден' }));
            return;
        }
        savedReviews.splice(index, 1);
        console.log('🗑️ Отзыв удалён');
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'success' }));
        return;
    }

    // DELETE /delete-item/:id
    if (req.method === 'DELETE' && req.url.startsWith('/delete-item/')) {
        var itemId = req.url.split('/').pop();
        var url = new URL(req.url, 'http://' + req.headers.host);
        var reason = url.searchParams.get('reason') || 'Нарушение правил';
        var username = url.searchParams.get('username') || '';

        var index = -1;
        for (var i = 0; i < savedItems.length; i++) {
            if (savedItems[i].id === itemId) { index = i; break; }
        }
        if (index === -1) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Товар не найден' }));
            return;
        }

        var deletedItem = savedItems[index];
        var isAdmin = username === 'admin';
        var isOwner = deletedItem.seller === username;
        if (!isAdmin && !isOwner) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Нет прав на удаление' }));
            return;
        }

        savedItems.splice(index, 1);
        console.log('🗑️ Удалён: ' + deletedItem.title + ' (' + reason + ')');

        for (var j = 0; j < onlineUsers.length; j++) {
            onlineUsers[j].write('data: ' + JSON.stringify({
                type: 'item_deleted',
                data: {
                    itemId: itemId,
                    title: deletedItem.title,
                    reason: reason,
                    seller: deletedItem.seller
                }
            }) + '\n\n');
        }

        res.writeHead(200);
        res.end(JSON.stringify({ status: 'success', reason: reason }));
        return;
    }

    // PUT /update-item/:id
    if (req.method === 'PUT' && req.url.startsWith('/update-item/')) {
        var itemId = req.url.split('/').pop();
        var body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', function() {
            try {
                var updatedData = JSON.parse(body);
                var index = -1;
                for (var i = 0; i < savedItems.length; i++) {
                    if (savedItems[i].id === itemId) { index = i; break; }
                }
                if (index === -1) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Товар не найден' }));
                    return;
                }
                savedItems[index] = Object.assign({}, savedItems[index], updatedData);
                console.log('📝 Обновлён: ' + savedItems[index].title);
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'success' }));
            } catch (err) {
                res.writeHead(400);
                res.end();
            }
        });
        return;
    }

    // POST /add-item
    if (req.method === 'POST' && req.url === '/add-item') {
        var body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', function() {
            try {
                var itemData = JSON.parse(body);
                itemData.id = 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

                if (!itemData.seller || itemData.seller === 'Гость') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: '❌ Гости не могут размещать объявления. Зарегистрируйтесь!',
                        status: 'forbidden'
                    }));
                    return;
                }

                if (itemData.imei && itemData.imei !== '—') {
                    if (!isValidImei(itemData.imei)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            error: '❌ IMEI должен содержать ровно 15 цифр!',
                            status: 'invalid_imei'
                        }));
                        return;
                    }
                }

                var fullText = itemData.model + ' ' + itemData.description;
                if (containsForbiddenWords(fullText)) {
                    console.warn('🚫 Модерация заблокировала: "' + itemData.model + '" от ' + itemData.seller);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Объявление заблокировано автоматической модерацией REBOOT за подозрительное содержимое!',
                        status: 'blocked'
                    }));
                    return;
                }

                savedItems.unshift(itemData);
                console.log('📦 ' + itemData.seller + ' добавил: ' + itemData.brand + ' ' + itemData.model);

                for (var i = 0; i < onlineUsers.length; i++) {
                    onlineUsers[i].write('data: ' + JSON.stringify({ type: 'new_item', data: itemData }) + '\n\n');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', id: itemData.id }));

            } catch (err) {
                res.writeHead(400);
                res.end();
            }
        });
        return;
    }

    // POST /send-message
    if (req.method === 'POST' && req.url === '/send-message') {
        var body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', function() {
            try {
                var msgData = JSON.parse(body);

                if (!msgData.sender || msgData.sender === 'Гость') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: '❌ Гости не могут отправлять сообщения. Зарегистрируйтесь!',
                        status: 'forbidden'
                    }));
                    return;
                }

                savedMessages.push(msgData);
                console.log('💬 ' + msgData.sender + ': ' + msgData.text);

                for (var i = 0; i < onlineUsers.length; i++) {
                    onlineUsers[i].write('data: ' + JSON.stringify({ type: 'new_message', data: msgData }) + '\n\n');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));

            } catch (err) {
                res.writeHead(400);
                res.end();
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(3000, function() {
    console.log('🚀 REBOOT Server запущен на http://localhost:3000');
    console.log('👑 Админ: admin / admin123');
    console.log('📦 IMEI валидация: ровно 15 цифр');
    console.log('🛡️ Модерация: стоп-слова активны');
});