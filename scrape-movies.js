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

        // حظر الصور فقط لتسريع التحميل
        await page.route('**/*', (route) => {
            if (route.request().resourceType() === 'image') {
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

        console.log('⏳ انتظار تجاوز Cloudflare...');
        await page.waitForTimeout(10000);

        // تمرير الصفحة
        console.log('📜 تمرير الصفحة لتحميل جميع الأفلام...');
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
        await page.waitForTimeout(5000);

        // استخراج الأفلام
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
                } catch (e) {}
            });

            return moviesList;
        });

        console.log(`✅ تم العثور على ${movies.length} فيلم\n`);

        // استخراج السيرفرات - بنفس طريقة الصفحة الرئيسية
        console.log('🖥️ بدء استخراج السيرفرات...\n');

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            console.log(`[${i + 1}/${movies.length}] ${movie.title}`);

            try {
                // تحميل صفحة المشاهدة بنفس طريقة الصفحة الرئيسية
                console.log('  🔗 تحميل صفحة المشاهدة...');
                await page.goto(movie.watch_url, {
                    waitUntil: 'networkidle',
                    timeout: 60000,
                });

                // انتظار طويل عشان فحص مانع الإعلانات والسيرفرات تلحق تتحمل
                console.log('  ⏳ انتظار تحميل السيرفرات وفحص مانع الإعلانات...');
                await page.waitForTimeout(12000);

                // تمرير بسيط لتنشيط العناصر
                await page.evaluate(() => {
                    window.scrollBy(0, 300);
                });
                await page.waitForTimeout(2000);

                // استخراج جميع الجودات
                const qualities = await page.evaluate(() => {
                    const qualityItems = document.querySelectorAll('.qualities__list li');
                    return Array.from(qualityItems).map(item => ({
                        quality: item.getAttribute('data-quality'),
                        isActive: item.classList.contains('active')
                    }));
                });

                if (qualities.length > 0) {
                    console.log(`  📺 الجودات: ${qualities.map(q => q.quality + 'p').join(', ')}`);
                    movie.servers = {};

                    for (const quality of qualities) {
                        try {
                            // النقر على الجودة
                            if (!quality.isActive) {
                                await page.click(`li[data-quality="${quality.quality}"]`);
                                await page.waitForTimeout(3000); // انتظار تحميل سيرفرات الجودة
                            }

                            // استخراج السيرفرات
                            const servers = await page.evaluate((qu) => {
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
                    console.log('  ⚠️ لم يتم العثور على جودات، قد يكون هناك Cloudflare');
                    // محاولة انتظار إضافي
                    await page.waitForTimeout(10000);
                    
                    // إعادة المحاولة
                    const qualitiesRetry = await page.evaluate(() => {
                        const qualityItems = document.querySelectorAll('.qualities__list li');
                        return Array.from(qualityItems).map(item => ({
                            quality: item.getAttribute('data-quality'),
                            isActive: item.classList.contains('active')
                        }));
                    });
                    
                    if (qualitiesRetry.length > 0) {
                        console.log('  ✅ تم العثور على الجودات بعد الانتظار الإضافي');
                        movie.servers = {};
                        
                        for (const quality of qualitiesRetry) {
                            try {
                                if (!quality.isActive) {
                                    await page.click(`li[data-quality="${quality.quality}"]`);
                                    await page.waitForTimeout(3000);
                                }
                                
                                const servers = await page.evaluate((qu) => {
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
                                movie.servers[`${quality.quality}p`] = [];
                            }
                        }
                    } else {
                        movie.servers = {};
                    }
                }

                movie.scraped_at = new Date().toISOString();

            } catch (error) {
                console.log(`  ❌ خطأ: ${error.message}`);
                movie.servers = {};
                movie.scraped_at = new Date().toISOString();
            }

            // حفظ بعد كل فيلم
            fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');
            
            console.log(`  💾 تم حفظ البيانات\n`);

            // تأخير بين الأفلام
            if (i < movies.length - 1) {
                console.log('  ⏳ انتظار 5 ثوان قبل الفيلم التالي...\n');
                await page.waitForTimeout(5000);
            }
        }

        // حفظ نهائي
        fs.writeFileSync('movies.json', JSON.stringify(movies, null, 2), 'utf-8');
        
        const moviesWithServers = movies.filter(m => m.servers && Object.keys(m.servers).length > 0);
        const totalServers = movies.reduce((sum, m) => {
            if (m.servers) {
                Object.values(m.servers).forEach(s => sum += s.length);
            }
            return sum;
        }, 0);
        
        console.log('\n✨ الانتهاء!');
        console.log(`📊 إجمالي الأفلام: ${movies.length}`);
        console.log(`🖥️ أفلام مع سيرفرات: ${moviesWithServers.length}`);
        console.log(`🔗 إجمالي السيرفرات: ${totalServers}`);

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

scrapeMovies();
