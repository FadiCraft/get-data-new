const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const browserConfig = {
    headless: true, 
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
    ]
};

async function simulateHumanBehavior(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
        window.chrome = { runtime: {} };
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
}

async function scrapeMovies() {
    const browser = await chromium.launch(browserConfig);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'ar-SA',
    });

    const page = await context.newPage();
    
    try {
        console.log('🔄 جاري تحميل الصفحة الرئيسية للأفلام...');
        await simulateHumanBehavior(page);
        
        // استخدام domcontentloaded لتجنب التعليق بسبب الإعلانات بالرئيسية
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 40000,
        });

        console.log('⏳ في انتظار ثبات الصفحة الرئيسية...');
        await page.waitForTimeout(5000);

        // استخراج الأفلام
        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];
            movieElements.forEach((element) => {
                const linkElement = element.querySelector('a.movie__block');
                const titleElement = element.querySelector('h3');
                if (linkElement && titleElement) {
                    let watchUrl = linkElement.href.endsWith('/') ? linkElement.href + 'watch/' : linkElement.href + '/watch/';
                    moviesData.push({
                        title: titleElement.textContent.trim(),
                        movie_url: linkElement.href,
                        watch_url: watchUrl,
                        servers: []
                    });
                }
            });
            return moviesData;
        });

        if (movies.length === 0) {
            console.log('⚠️ لم يتم العثور على أفلام بالرئيسية، سنلتقط صورة للتحقق.');
            await page.screenshot({ path: 'main-page-empty.png', fullPage: true });
            return;
        }

        const movie = movies[0];
        console.log(`\n🧪 [وضع الفحص الأحادي] - الفيلم المستهدف: ${movie.title}`);
        console.log(`🔗 رابط المشاهدة: ${movie.watch_url}`);

        // تفعيل مراقبة الشبكة لرصد الروابط ديناميكياً
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('admin-ajax.php') || url.includes('play') || url.includes('server')) {
                console.log(`📡 [Network Request] -> ${url}`);
            }
        });

        try {
            console.log('🚀 جاري الانتقال لصفحة المشاهدة...');
            // تم تغييرها لـ domcontentloaded وتخفيض الـ timeout لتفادي التعليق اللانهائي للإعلانات
            await page.goto(movie.watch_url, { waitUntil: 'domcontentloaded', timeout: 35000 });
            
            // محاكاة سكرول لتحفيز السكربتات
            await page.evaluate(() => window.scrollBy(0, 500));
            
            console.log('⏳ ننتظر 8 ثوانٍ هادئة لتكتمل طلبات السيرفرات الخلفية...');
            await page.waitForTimeout(8000);

            // محاولة الكشط من الـ DOM
            const htmlServers = await page.evaluate(() => {
                const serverItems = document.querySelectorAll('.servers__list ul li');
                const extracted = [];
                serverItems.forEach((li) => {
                    const nameElement = li.querySelector('span');
                    const link = li.getAttribute('data-link');
                    if (link) {
                        extracted.push({
                            name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                            link: link.trim(),
                            quality: li.getAttribute('data-qu') || 'unknown'
                        });
                    }
                });
                return extracted;
            });

            movie.servers = htmlServers;

            if (htmlServers.length > 0) {
                console.log(`✅ نجح الكشط! تم العثور على ${htmlServers.length} سيرفر.`);
                console.log(htmlServers);
            } else {
                console.log('⚠️ لم نجد سيرفرات في الـ HTML. سنلتقط صورة للصفحة الآن.');
                await page.screenshot({ path: 'watch-page-no-servers.png', fullPage: true });
                console.log('📸 تم حفظ الصورة باسم: watch-page-no-servers.png');
            }

        } catch (movieError) {
            console.error('❌ حدث خطأ أثناء معالجة صفحة المشاهدة:', movieError.message);
            // التقاط صورة فورية لمتصفح عند حدوث الـ Timeout أو أي خطأ آخر
            await page.screenshot({ path: 'timeout-error-page.png', fullPage: true });
            console.log('📸 تم التقاط صورة للخطأ وحفظها باسم: timeout-error-page.png');
        }

        // حفظ ملف التجربة في كل الأحوال لتعاين البيانات
        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');

    } catch (error) {
        console.error('❌ حدث خطأ عام بالسكريبت:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
