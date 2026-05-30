const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// تكوين المتصفح لتجاوز Cloudflare
const browserConfig = {
    headless: true, // يمكنك تغييرها إلى false إذا كنت تريد رؤية المتصفح وهو يعمل أمامك
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
        
        // تعطيل تحميل الصور لتسريع العملية
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

        console.log('⏳ في انتظار تجاوز حماية Cloudflare...');
        await page.waitForTimeout(5000);

        // استخراج بيانات الأفلام الأساسية
        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];

            movieElements.forEach((element) => {
                try {
                    const linkElement = element.querySelector('a.movie__block');
                    const titleElement = element.querySelector('h3');

                    if (linkElement && titleElement) {
                        let watchUrl = linkElement.href;
                        // استبدال كلمة movie بـ watch للذهاب لصفحة المشاهدة مباشرة
                        if (watchUrl.includes('/movie/')) {
                            watchUrl = watchUrl.replace('/movie/', '/watch/');
                        }

                        moviesData.push({
                            title: titleElement.textContent.trim(),
                            movie_url: linkElement.href,
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

        console.log(`🎬 تم العثور على ${movies.length} فيلم الكلي.`);
        console.log(`🧪 [وضع التجربة]: سيتم فحص أول فيلم فقط وهو: (${movies[0].title})`);

        // فحص الفيلم الأول فقط للتجربة
        const movie = movies[0];
        console.log(`🔗 جاري فتح صفحة المشاهدة للتجربة: ${movie.watch_url}`);
        
        try {
            await page.goto(movie.watch_url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000); // انتظار إضافي للتأكد من تحميل السيرفرات بالكامل

            // استخراج السيرفرات
            const servers = await page.evaluate(() => {
                const serverItems = document.querySelectorAll('.servers__list ul li');
                const extractedServers = [];

                serverItems.forEach((li) => {
                    const nameElement = li.querySelector('span');
                    const link = li.getAttribute('data-link');
                    const quality = li.getAttribute('data-qu');
                    
                    if (link) {
                        extractedServers.push({
                            name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                            link: link,
                            quality: quality || 'unknown'
                        });
                    }
                });
                return extractedServers;
            });

            movie.servers = servers;

            if (servers.length > 0) {
                console.log(`✅ نجحت التجربة! تم استخراج ${servers.length} سيرفر لهذا الفيلم.`);
                console.log('📋 السيرفرات المستخرجة:', servers);
            } else {
                console.log('⚠️ تم فتح الصفحة ولكن لم يتم العثور على أي سيرفرات داخل الـ HTML. سيتم أخذ لقطة شاشة للتحقق.');
                await page.screenshot({ path: `no-servers-found-${Date.now()}.png`, fullPage: true });
            }

        } catch (movieError) {
            console.error(`❌ فشل استخراج سيرفرات الفيلم: ${movieError.message}`);
            // التقاط صورة للمتصفح عند حدوث الخطأ لمعرفة السبب
            const screenshotName = `error-${movie.title.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
            await page.screenshot({ path: screenshotName, fullPage: true });
            console.log(`📸 تم حفظ لقطة شاشة للخطأ باسم: ${screenshotName}`);
        }

        // حفظ نتيجة الفيلم التجريبي في ملف الـ JSON لتعاين البنية بنفسك
        const outputData = {
            metadata: {
                scraped_at: new Date().toISOString(),
                test_mode: true,
                status: movie.servers.length > 0 ? 'success' : 'failed'
            },
            test_movie: movie
        };

        fs.writeFileSync(path.join(process.cwd(), 'test_movie_server.json'), JSON.stringify(outputData, null, 2), 'utf-8');
        console.log(`📁 تم حفظ ملف التجربة في: test_movie_server.json`);

    } catch (error) {
        console.error('❌ حدث خطأ عام بالسكريبت:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
