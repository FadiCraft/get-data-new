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
        viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    
    try {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
        });

        // حظر الصور فقط لتسريع التحميل مع إبقاء الجافاسكربت
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (type === 'image') {
                route.abort();
            } else {
                route.continue();
            }
        });

        console.log('🔄 تحميل الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        console.log('⏳ انتظار تحميل الصفحة...');
        await page.waitForTimeout(10000);

        // التحقق من وجود الأفلام
        const moviesExist = await page.$('.movie__block');
        if (!moviesExist) {
            console.log('⚠️ Cloudflare مانع التحميل، جاري المحاولة مرة أخرى...');
            await page.waitForTimeout(10000);
        }

        // تمرير الصفحة
        console.log('📜 تمرير الصفحة لتحميل الأفلام...');
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 800);
            });
        });
        await page.waitForTimeout(3000);

        // استخراج الأفلام مع روابطها
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
                        // استخراج الرابط المختصر للمشاهدة من الرابط الأساسي
                        // نجرب نحصل على صفحة المشاهدة بنفس النمط
                        const baseWatchUrl = movieUrl.replace(/\/$/, '') + '/watch/';
                        
                        moviesList.push({
                            title: title.textContent.trim(),
                            url: movieUrl,
                            watch_url: baseWatchUrl,
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

        console.log(`✅ تم العثور على ${movies.length} فيلم\n`);

        // الآن نستخرج السيرفرات لكل فيلم
        console.log('🖥️ بدء استخراج السيرفرات...\n');

        // فتح صفحة جديدة لكل فيلم لتجنب مشاكل Cloudflare
        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            console.log(`[${i + 1}/${movies.length}] ${movie.title}`);

            const moviePage = await context.newPage();
            
            // إضافة نفس السكربتات للصفحة الجديدة
            await moviePage.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                window.chrome = { runtime: {} };
            });

            // حظر الصور
            await moviePage.route('**/*', (route) => {
                if (route.request().resourceType() === 'image') {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            try {
                // تحميل صفحة الفيلم أولاً
                console.log('  🔗 تحميل صفحة الفيلم...');
                await moviePage.goto(movie.url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });
                await moviePage.waitForTimeout(5000);

                // استخراج رابط المشاهدة الحقيقي من الصفحة
                const realWatchUrl = await moviePage.evaluate(() => {
                    const watchLink = document.querySelector('a.watch__btn');
                    return watchLink ? watchLink.href : null;
                });

                if (realWatchUrl) {
                    console.log('  ✅ تم العثور على رابط المشاهدة');
                    
                    // تحميل صفحة المشاهدة
                    console.log('  🔗 تحميل صفحة المشاهدة...');
                    await moviePage.goto(realWatchUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000,
                    });
                    await moviePage.waitForTimeout(6000);

                    // استخراج الجودات والسيرفرات
                    const qualities = await moviePage.evaluate(() => {
                        const qualityItems = document.querySelectorAll('.qualities__list li');
                        if (qualityItems.length === 0) return [];
                        
                        return Array.from(qualityItems).map(item => ({
                            quality: item.getAttribute('data-quality'),
                            title: item.getAttribute('data-title'),
                            isActive: item.classList.contains('active')
                        }));
                    });

                    if (qualities.length > 0) {
                        console.log(`  📺 الجودات: ${qualities.map(q => q.quality + 'p').join(', ')}`);
                        movie.servers = {};

                        for (const quality of qualities) {
                            try {
                                if (!quality.isActive) {
                                    await moviePage.click(`li[data-quality="${quality.quality}"]`);
                                    await moviePage.waitForTimeout(2000);
                                }

                                const servers = await moviePage.evaluate((qu) => {
                                    const items = document.querySelectorAll(`.servers__list li[data-qu="${qu}"]`);
                                    return Array.from(items).map(server => ({
                                        name: server.querySelector('span')?.textContent.trim() || 'Unknown',
                                        server_id: server.getAttribute('data-server'),
                                        quality: server.getAttribute('data-qu'),
                                        link: server.getAttribute('data-link'),
                                    }));
                                }, quality.quality);

                                movie.servers[`${quality.quality}p`] = servers;
                                console.log(`  ✅ ${quality.quality}p: ${servers.length} سيرفر`);
                            } catch (error) {
                                console.log(`  ⚠️ ${quality.quality}p: ${error.message}`);
                                movie.servers[`${quality.quality}p`] = [];
                            }
                        }
                    } else {
                        console.log('  ⚠️ لم يتم العثور على سيرفرات');
                        movie.servers = {};
                    }
                } else {
                    console.log('  ⚠️ رابط المشاهدة غير موجود');
                    movie.servers = {};
                }

                movie.scraped_at = new Date().toISOString();

            } catch (error) {
                console.log(`  ❌ خطأ: ${error.message}`);
                movie.servers = {};
                movie.scraped_at = new Date().toISOString();
            } finally {
                await moviePage.close();
            }

            // حفظ بعد كل فيلم
            fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');
            
            if (i < movies.length - 1) {
                console.log('  ⏳ انتظار...\n');
                await page.waitForTimeout(4000);
            }
        }

        fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');
        
        const totalServers = movies.reduce((sum, m) => {
            if (m.servers) {
                Object.values(m.servers).forEach(s => sum += s.length);
            }
            return sum;
        }, 0);
        
        console.log('\n✨ انتهى!');
        console.log(`📊 أفلام: ${movies.length} | 🖥️ سيرفرات: ${totalServers}`);

    } catch (error) {
        console.error('❌', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

scrapeMovies();
