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
        
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });

        console.log('⏳ في انتظار استقرار الصفحة الرئيسية...');
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
            console.log('⚠️ لم يتم العثور على أفلام بالرئيسية.');
            return;
        }

        // تخصيص العمل على الفيلم الأول فقط اختصاراً للوقت
        const movie = movies[0];
        console.log(`\n🧪 [وضع الفحص الأحادي] - الفيلم المستهدف: ${movie.title}`);
        console.log(`🔗 رابط المشاهدة: ${movie.watch_url}`);

        // مصفوفة لتخزين أي روابط مشبوهة أو استجابات تحتوي على كلمات مفتاحية (مثل play, server, watch, posts)
        let networkInterceptedServers = [];

        // تفعيل مراقبة الشبكة لالتقاط الـ API Requests الخلفية
        page.on('response', async (response) => {
            const url = response.url();
            const method = response.request().method();
            
            // فلترة الطلبات التي تطلب ملفات الميديا أو السيرفرات أو أياكس
            if (url.includes('admin-ajax.php') || url.includes('play') || url.includes('server') || url.includes('wp-json')) {
                console.log(`📡 [Network Request] ${method} -> ${url}`);
                try {
                    // إذا كانت الاستجابة نصية أو JSON، نقوم بطباعتها أو فحصها
                    const contentType = response.headers()['content-type'] || '';
                    if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
                        const text = await response.text();
                        // إذا كانت الاستجابة تحتوي على الروابط التي نبحث عنها
                        if (text.includes('data-link') || text.includes('iframe') || text.includes('embed') || text.includes('play.php')) {
                            console.log(`🎯 عثرنا على استجابة شبكة تحتوي على روابط السيرفرات!`);
                            // حفظ الاستجابة لتحليلها لاحقاً إذا لزم الأمر
                            fs.writeFileSync('network_response_debug.txt', text);
                        }
                    }
                } catch (e) {
                    // تجنب الأخطاء في حال كانت الاستجابة غير قابلة للقراءة
                }
            }
        });

        // الذهاب لصفحة المشاهدة
        await page.goto(movie.watch_url, { waitUntil: 'networkidle', timeout: 60000 });
        
        // التمرير الهادئ لأسفل لتحفيز الأكواد
        await page.evaluate(() => window.scrollBy(0, 500));
        
        console.log('⏳ ننتظر 8 ثوانٍ للسماح للشبكة بإنهاء كل الطلبات الخلفية...');
        await page.waitForTimeout(8000);

        // محاولة كشط الـ DOM التقليدي مجدداً بعد انتظار الشبكة
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
            console.log(`✅ نجح الكشط من الـ HTML مباشرة! تم العثور على ${htmlServers.length} سيرفر.`);
            console.log(htmlServers);
        } else {
            console.log('⚠️ الـ HTML لا يزال فارغاً. يرجى مراجعة سجلات الـ [Network Request] المطبوعة بالأعلى لرؤية الرابط الخلفي.');
            await page.screenshot({ path: 'single-movie-network-debug.png', fullPage: true });
            console.log('📸 تم حفظ لقطة شاشة للتحقق: single-movie-network-debug.png');
        }

        // حفظ ملف التجربة
        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
        console.log(`📁 تم حفظ النتيجة في: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
