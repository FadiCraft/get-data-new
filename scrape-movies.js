// استخدام playwright-extra لتشغيل وضع التخفي (Stealth)
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي المتقدم...');
    const browser = await chromium.launch({
        headless: true, // اتركها true لـ GitHub Actions
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--use-fake-ui-for-media-stream',
            '--window-size=1920,1080'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
    });

    const page = await context.newPage();

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // مهلة عشوائية لتبدو حركة طبيعية وتجاوز الجدار الأول
        await page.waitForTimeout(7000);

        // التمرير قليلاً لأسفل للتأكيد للموقع أننا لسنا بوتاً بليداً
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);

        // استخراج الأفلام المتواجدة
        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];
            movieElements.forEach((element) => {
                const linkElement = element.querySelector('a.movie__block');
                const titleElement = element.querySelector('h3');
                if (linkElement && titleElement) {
                    moviesData.push({
                        title: titleElement.textContent.trim(),
                        movie_url: linkElement.href
                    });
                }
            });
            return moviesData;
        });

        if (movies.length === 0) {
            console.log('⚠️ فشل استخراج الأفلام من الرئيسية بسبب جدار الحماية.');
            await page.screenshot({ path: 'cloudflare-blocked-main.png', fullPage: true });
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        console.log(`🔗 رابط الفيلم الأصلي: ${movie.movie_url}`);

        // صياغة رابط الـ watch
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;
        movie.servers = [];

        // الحيلة الكبرى: ننتقل أولاً لرابط الفيلم الأصلي لنرث الـ Cookies الموثوقة
        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);
        await page.evaluate(() => window.scrollBy(0, 300));

        // الآن ننتقل إلى رابط الـ watch بعد أن وثق الموقع بالمتصفح الخاص بنا
        console.log('🎬 جاري الانتقال الآمن لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // محاكاة حركة بشرية داخل صفحة السيرفرات
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار 7 ثوانٍ لفك شيفرة حاوية السيرفرات...');
        await page.waitForTimeout(7000);

        // التقاط لقطة شاشة للتأكد من تخطي الكابتشا بنجاح ورؤية الصفحة
        await page.screenshot({ path: 'watch-page-inside-result.png', fullPage: true });
        console.log('📸 تم التقاط صورة للنتيجة الحالية باسم: watch-page-inside-result.png');

        // كشط السيرفرات
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
            console.log(`✅ انتصار! تم تجاوز الحماية واستخراج ${htmlServers.length} سيرفر للفيلم الأول!`);
            console.log(htmlServers);
        } else {
            console.log('⚠️ الصفحة فُتحت ولكن لم نجد عناصر السيرفرات بعد في الـ DOM، تفحص الصورة المرفوعة.');
        }

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
        await page.screenshot({ path: 'fatal-error-debug.png', fullPage: true });
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
