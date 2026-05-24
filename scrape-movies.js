const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// تكوين المتصفح لتجاوز Cloudflare والحماية
const browserConfig = {
    headless: true, 
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
    ]
};

// محاكاة سلوك بشري لتجنب كشف البوت
async function simulateHumanBehavior(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
        window.chrome = { runtime: {} };
    });

    await page.setViewportSize({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 1080 + Math.floor(Math.random() * 100)
    });
}

async function scrapeMovies() {
    const browser = await chromium.launch(browserConfig);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
    });

    const page = await context.newPage();
    
    try {
        console.log('🔄 جاري تحميل الصفحة الرئيسية للأفلام...');
        await simulateHumanBehavior(page);
        
        // تعطيل تحميل الصور والخطوط لتسريع العملية
        await page.route('**/*', (route) => {
            const request = route.request();
            if (request.resourceType() === 'image' || request.resourceType() === 'font') {
                route.abort();
            } else {
                route.continue();
            }
        });

        // تحميل الصفحة الرئيسية
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });

        console.log('⏳ في انتظار تجاوز حماية Cloudflare وتثبيت الصفحة...');
        await page.waitForTimeout(6000);

        // استخراج بيانات الأفلام الأساسية
        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];

            movieElements.forEach((element) => {
                try {
                    const linkElement = element.querySelector('a.movie__block');
                    const titleElement = element.querySelector('h3');

                    if (linkElement && titleElement) {
                        let originalUrl = linkElement.href;
                        let watchUrl = originalUrl;

                        // معالجة الرابط لإضافة /watch/ في النهاية بطريقة ذكية تتماشى مع الروابط المرمزة (Encoded URIs)
                        if (watchUrl.endsWith('/')) {
                            watchUrl = watchUrl + 'watch/';
                        } else {
                            watchUrl = watchUrl + '/watch/';
                        }

                        moviesData.push({
                            title: titleElement.textContent.trim(),
                            movie_url: originalUrl,
                            watch_url: watchUrl,
                            servers: []
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            return moviesData;
        });

        if (movies.length === 0) {
            console.log('⚠️ لم يتم العثور على أي أفلام في الصفحة الرئيسية، قد تكون الحماية حظرت الطلب.');
            await page.screenshot({ path: 'main-page-error.png', fullPage: true });
            return;
        }

        console.log(`🎬 تم العثور على ${movies.length} فيلم. جاري بدء استخراج سيرفرات المشاهدة...`);

        // حلقة تكرارية للمرور على كل الأفلام المستخرجة بدلاً من فيلم واحد
        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            console.log(`\n================ [ ${i + 1} / ${movies.length} ] ================`);
            console.log(`🎥 الفيلم الحالي: ${movie.title}`);
            console.log(`🔗 رابط المشاهدة: ${movie.watch_url}`);
            
            try {
                // الانتقال لصفحة المشاهدة وانتظار استقرار الشبكة
                await page.goto(movie.watch_url, { waitUntil: 'networkidle', timeout: 45000 });
                
                // محاكاة سلوك بشري بالتمرير لأسفل لضمان تفعيل لودر السيرفرات إن وجد
                await page.evaluate(() => window.scrollBy(0, 400));
                
                // ترك مهلة زمنية مريحة لكي تستقر الصفحة وتحمل الأكواد الديناميكية بالكامل
                await page.waitForTimeout(4000); 

                // كشط السيرفرات بناءً على هيكل الـ HTML الجديد لصفحة المشاهدة
                const servers = await page.evaluate(() => {
                    const serverItems = document.querySelectorAll('.servers__list ul li');
                    const extractedServers = [];

                    serverItems.forEach((li) => {
                        const nameElement = li.querySelector('span');
                        const link = li.getAttribute('data-link');
                        const quality = li.getAttribute('data-qu');
                        const serverIndex = li.getAttribute('data-server');
                        const postId = li.getAttribute('data-post');
                        
                        if (link) {
                            extractedServers.push({
                                server_id: serverIndex || '0',
                                post_id: postId || '',
                                name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                                link: link.trim(),
                                quality: quality || 'unknown'
                            });
                        }
                    });
                    return extractedServers;
                });

                movie.servers = servers;

                if (servers.length > 0) {
                    console.log(`✅ تم استخراج ${servers.length} سيرفر بنجاح لهذا الفيلم.`);
                } else {
                    console.log('⚠️ لم يتم العثور على سيرفرات داخل الـ HTML، قد تحتاج الصفحة لوقت أطول أو السيرفرات محمية.');
                }

                // انتظار عشوائي صغير بين كل فيلم وفيلم لتجنب كشف العمليات المتتالية (Anti-Scraping Rate Limit)
                const randomDelay = Math.floor(Math.random() * 2000) + 1500; 
                await page.waitForTimeout(randomDelay);

            } catch (movieError) {
                console.error(`❌ فشل استخراج سيرفرات الفيلم [${movie.title}]: ${movieError.message}`);
            }
        }

        // حفظ البيانات النهائية لجميع الأفلام مع سيرفراتها
        const outputData = {
            metadata: {
                scraped_at: new Date().toISOString(),
                total_movies: movies.length,
                status: 'completed'
            },
            movies: movies
        };

        fs.writeFileSync(path.join(process.cwd(), 'movies_with_servers.json'), JSON.stringify(outputData, null, 2), 'utf-8');
        console.log(`\n Archiving Finished! 📁 تم حفظ الملف النهائي بنجاح في: movies_with_servers.json`);

    } catch (error) {
        console.error('❌ حدث خطأ عام بالسكريبت:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
