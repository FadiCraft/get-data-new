const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// دالة فك تشفير روابط الـ Base64
function decodeServerLink(rawLink) {
    try {
        let base64String = '';
        if (rawLink.includes('url=')) {
            base64String = rawLink.split('url=')[1];
        } else if (rawLink.includes('id=')) {
            base64String = rawLink.split('id=')[1];
        } else {
            return rawLink;
        }
        return Buffer.from(base64String, 'base64').toString('utf-8');
    } catch (e) {
        return rawLink;
    }
}

// دالة ذكية لإعطاء وزن/أولوية لكل سيرفر بناءً على نطاق الـ iframe (كلما قل الوزن، زادت الأولوية)
function getServerPriority(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1; // الأولوية الأولى
    if (lowerUrl.includes('vidara')) return 2;  // الأولوية الثانية
    if (lowerUrl.includes('voe')) return 3;     // الأولوية الثالثة
    return 4;                                   // أي سيرفر آخر يدعم m3u8 ديناميكي
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي المتقدم...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
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

        await page.waitForTimeout(6000);
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);

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
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;
        movie.servers = [];

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 جاري الانتقال الآمن لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار لفك شيفرة حاوية السيرفرات...');
        await page.waitForTimeout(7000);

        // كشط السيرفرات الخام من الـ HTML
        const rawServers = await page.evaluate(() => {
            const serverItems = document.querySelectorAll('.servers__list ul li');
            const extracted = [];
            serverItems.forEach((li) => {
                const nameElement = li.querySelector('span');
                const link = li.getAttribute('data-link');
                if (link) {
                    extracted.push({
                        name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                        raw_link: link.trim(),
                        quality: li.getAttribute('data-qu') || 'unknown'
                    });
                }
            });
            return extracted;
        });

        // تصفية، استبعاد، وفك التشفير
        let processedServers = [];
        for (const srv of rawServers) {
            // 1. استبعاد سيرفر عرب سيد تماماً بناءً على الاسم المكتوب
            if (srv.name.includes('عرب سيد')) {
                continue; 
            }

            const cleanIframeUrl = decodeServerLink(srv.raw_link);
            
            processedServers.push({
                name: srv.name,
                quality: srv.quality,
                iframe_url: cleanIframeUrl,
                priority: getServerPriority(cleanIframeUrl) // تحديد رتبة الأولوية
            });
        }

        // 2. إعادة ترتيب المصفوفة تصاعدياً بناءً على رتبة الأولوية (Priority)
        processedServers.sort((a, b) => a.priority - b.priority);

        // 3. إعادة تسمية السيرفرات بشكل مرقم ومنظم لتطبيقك (سيرفر 1، سيرفر 2...) بعد الترتيب الجديد
        processedServers = processedServers.map((srv, index) => {
            return {
                name: `سيرفر ${index + 1}`, // تضمن أن يبدأ جهازك دائماً برقم 1 كأفضل خيار
                quality: srv.quality,
                iframe_url: srv.iframe_url
            };
        });

        movie.servers = processedServers;

        if (processedServers.length > 0) {
            console.log(`\n📊 تم تصفية وترتيب السيرفرات حسب الأفضلية لتطبيقك:`);
            console.log(JSON.stringify(processedServers, null, 2));
        } else {
            console.log('⚠️ لم يتم العثور على سيرفرات صالحة بعد التصفية.');
        }

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
        console.log(`\n📁 تم حفظ ملف البيانات المحدث والمصفى في: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
