const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeMovies() {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
    });

    const page = await context.newPage();
    
    try {
        // إخفاء أننا بوت
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
        });

        // حظر الصور والفيديوهات لتسريع التحميل
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        console.log('🔄 تحميل الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });

        // انتظار Cloudflare
        console.log('⏳ انتظار تجاوز الحماية...');
        await page.waitForTimeout(8000);

        // تمرير لتحميل كل الأفلام
        console.log('📜 تمرير الصفحة...');
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 1000);
            });
        });
        await page.waitForTimeout(3000);

        // استخراج الأفلام مع روابط المشاهدة
        console.log('📋 استخراج قائمة الأفلام...');
        const movies = await page.evaluate(() => {
            const items = document.querySelectorAll('li .item__contents');
            const moviesList = [];

            items.forEach((item) => {
                try {
                    const link = item.querySelector('a.movie__block');
                    const img = item.querySelector('img');
                    const title = item.querySelector('h3');
                    const category = item.querySelector('.post__category');
                    const genre = item.querySelector('.__genre');
                    const quality = item.querySelector('.__quality');
                    const description = item.querySelector('.post__info p');

                    if (link && title) {
                        const movieUrl = link.href;
                        // استخراج رابط المشاهدة من الرابط الأساسي
                        const watchUrl = movieUrl.replace(/\/$/, '') + '/watch/';
                        
                        moviesList.push({
                            title: title.textContent.trim(),
                            url: movieUrl,
                            watch_url: watchUrl,
                            image: img ? img.src : null,
                            image_alt: img ? img.alt : null,
                            category: category ? category.textContent.trim() : null,
                            genre: genre ? genre.textContent.trim() : null,
                            quality: quality ? quality.textContent.trim() : null,
                            description: description ? description.textContent.trim() : null,
                        });
                    }
                } catch (e) {
                    console.error('Error:', e);
                }
            });

            return moviesList;
        });

        console.log(`✅ تم العثور على ${movies.length} فيلم`);

        // استخراج السيرفرات لكل فيلم
        console.log('\n🖥️ بدء استخراج السيرفرات...\n');

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            console.log(`[${i + 1}/${movies.length}] ${movie.title}`);

            try {
                // تحميل صفحة المشاهدة
                await page.goto(movie.watch_url, {
                    waitUntil: 'networkidle',
                    timeout: 30000,
                });
                await page.waitForTimeout(3000);

                // استخراج جميع الجودات المتاحة
                const qualities = await page.evaluate(() => {
                    const qualityItems = document.querySelectorAll('.qualities__list li');
                    return Array.from(qualityItems).map(item => ({
                        quality: item.getAttribute('data-quality'),
                        title: item.getAttribute('data-title'),
                        isActive: item.classList.contains('active')
                    }));
                });

                if (qualities.length > 0) {
                    console.log(`  📺 الجودات المتاحة: ${qualities.map(q => q.quality + 'p').join(', ')}`);
                    
                    movie.servers = {};

                    // استخراج السيرفرات لكل جودة
                    for (const quality of qualities) {
                        try {
                            // النقر على الجودة إذا لم تكن نشطة
                            if (!quality.isActive) {
                                const qualitySelector = `li[data-quality="${quality.quality}"]`;
                                await page.waitForSelector(qualitySelector, { timeout: 5000 });
                                await page.click(qualitySelector);
                                await page.waitForTimeout(2000);
                            }

                            // استخراج السيرفرات
                            const servers = await page.evaluate((qu) => {
                                const serverItems = document.querySelectorAll(`.servers__list li[data-qu="${qu}"]`);
                                return Array.from(serverItems).map(server => ({
                                    name: server.querySelector('span')?.textContent.trim() || 'Unknown',
                                    server_id: server.getAttribute('data-server'),
                                    quality: server.getAttribute('data-qu'),
                                    link: server.getAttribute('data-link'),
                                }));
                            }, quality.quality);

                            movie.servers[`${quality.quality}p`] = servers;
                            console.log(`  ✅ ${quality.quality}p: ${servers.length} سيرفر`);
                        } catch (error) {
                            console.log(`  ⚠️ ${quality.quality}p: فشل - ${error.message}`);
                            movie.servers[`${quality.quality}p`] = [];
                        }
                    }
                } else {
                    console.log('  ⚠️ لم يتم العثور على سيرفرات');
                    movie.servers = {};
                }

                // إضافة تاريخ الاستخراج
                movie.scraped_at = new Date().toISOString();

                // حفظ البيانات بعد كل فيلم (احتياط)
                fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');

                // تأخير بين الأفلام
                if (i < movies.length - 1) {
                    console.log('  ⏳ انتظار 3 ثوان...');
                    await page.waitForTimeout(3000);
                }

            } catch (error) {
                console.log(`  ❌ خطأ: ${error.message}`);
                movie.servers = {};
                movie.scraped_at = new Date().toISOString();
                movie.error = error.message;
            }

            console.log('');
        }

        // حفظ نهائي
        fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');
        
        const totalServers = movies.reduce((sum, m) => {
            if (m.servers) {
                Object.values(m.servers).forEach(s => sum += s.length);
            }
            return sum;
        }, 0);
        
        console.log('✨ الانتهاء!');
        console.log(`📊 الأفلام: ${movies.length}`);
        console.log(`🖥️ السيرفرات: ${totalServers}`);

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

scrapeMovies();
