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

// دالة ذكية لإعطاء وزن/أولوية لكل سيرفر
function getServerPriority(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2;
    if (lowerUrl.includes('voe')) return 3;
    return 4;
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي المتقدم...');
    
    // يمكنك تفعيل تسجيل الفيديو عن طريق تعيين متغير البيئة RECORD_VIDEO=true
    const recordVideo = process.env.RECORD_VIDEO === 'true';
    
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
        // إعدادات تسجيل الفيديو (اختياري)
        recordVideo: recordVideo ? {
            dir: path.join(process.cwd(), 'videos'),
            size: { width: 1280, height: 720 }
        } : undefined
    });

    const page = await context.newPage();
    
    // إنشاء مجلدات اللقطات والفيديو إذا لزم الأمر
    const screenshotDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    if (recordVideo) {
        console.log('🔴 بدأ تسجيل الفيديو...');
    }

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(6000);
        await page.screenshot({ path: path.join(screenshotDir, '1-homepage.png'), fullPage: true });
        console.log('📸 تم التقاط صورة الصفحة الرئيسية');
        
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
        movie.qualities = [];

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(screenshotDir, '2-movie-page.png'), fullPage: true });
        console.log('📸 تم التقاط صورة صفحة الفيلم');

        console.log('🎬 جاري الانتقال لصفحة المشاهدة...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار لتحميل قائمة الجودات والسيرفرات...');
        await page.waitForTimeout(7000);
        await page.screenshot({ path: path.join(screenshotDir, '3-watch-page.png'), fullPage: true });
        console.log('📸 تم التقاط صورة صفحة المشاهدة');

        // التحقق من وجود قائمة الجودات
        const qualitySwitcher = await page.$('.quality__swither');
        if (!qualitySwitcher) {
            console.log('❌ لم يتم العثور على محول الجودات');
            return;
        }

        // --- بداية التعديل الأساسي ---
        
        // استخراج جميع الجودات المتاحة أولاً
        const availableQualities = await page.evaluate(() => {
            const qualityElements = document.querySelectorAll('.qualities__list li');
            const qualities = [];
            qualityElements.forEach((li) => {
                const quality = li.getAttribute('data-quality');
                const title = li.getAttribute('data-title');
                if (quality) {
                    qualities.push({
                        quality: quality,
                        title: title || '',
                        isActive: li.classList.contains('active')
                    });
                }
            });
            return qualities;
        });

        console.log(`📊 تم العثور على ${availableQualities.length} جودة: ${availableQualities.map(q => q.quality + 'p').join(', ')}`);

        // دالة مساعدة لفتح قائمة الجودات
        async function openQualityMenu() {
            console.log('   🔽 فتح قائمة الجودات المنسدلة...');
            try {
                await page.click('.quality__swither .title');
            } catch (e) {
                console.log('   ⚠️ النقر على العنوان فشل، محاولة النقر على الأيقونة...');
                try {
                    await page.click('.quality__swither .icon');
                } catch (e2) {
                    console.log('   ⚠️ محاولة أخيرة لفتح القائمة...');
                    await page.click('.quality__swither');
                }
            }
            await page.waitForTimeout(1000);
        }

        // دالة مساعدة لاختيار جودة معينة
        async function selectQuality(qualityValue) {
            console.log(`   👆 جاري اختيار الجودة ${qualityValue}p...`);
            
            // ننتظر حتى تكون قائمة الجودات ظاهرة
            await page.waitForSelector('.qualities__list', { state: 'visible', timeout: 5000 });
            
            // ننتظر العنصر المحدد للجودة وننقر عليه
            const qualitySelector = `.qualities__list li[data-quality="${qualityValue}"]`;
            try {
                await page.click(qualitySelector);
                console.log(`   ✅ تم النقر على الجودة ${qualityValue}p`);
            } catch (e) {
                console.log(`   ⚠️ فشل النقر المباشر، جاري استخدام JavaScript...`);
                await page.evaluate((q) => {
                    const element = document.querySelector(`.qualities__list li[data-quality="${q}"]`);
                    if (element) element.click();
                }, qualityValue);
            }
            
            // انتظار ذكي: ننتظر حتى تظهر السيرفرات أو حتى ينتهي أي تحميل
            console.log(`   ⏳ انتظار تحميل سيرفرات ${qualityValue}p...`);
            try {
                // الانتظار حتى يظهر على الأقل عنصر سيرفر واحد جديد
                await page.waitForSelector('.servers__list ul li[data-link]', { 
                    state: 'attached', 
                    timeout: 15000 
                });
                // انتظار إضافي قصير للتأكد من تحميل جميع السيرفرات
                await page.waitForTimeout(2000);
                console.log(`   ✅ تم تحميل السيرفرات بنجاح.`);
            } catch (waitError) {
                console.log(`   ⚠️ لم يتم اكتشاف سيرفرات جديدة بعد 15 ثانية. المتابعة بكشط الصفحة الحالية...`);
                await page.screenshot({ 
                    path: path.join(screenshotDir, `timeout-waiting-servers-${qualityValue}p.png`), 
                    fullPage: true 
                });
            }
        }

        // المرور على كل جودة واستخراج السيرفرات
        for (let i = 0; i < availableQualities.length; i++) {
            const qualityInfo = availableQualities[i];
            console.log(`\n🔄 جاري معالجة الجودة: ${qualityInfo.quality}p...`);

            // الخطوة 1: فتح قائمة الجودات إذا كنا بحاجة لتغيير الجودة
            if (i > 0) { // القائمة تكون مفتوحة افتراضياً لأول جودة، نعيد فتحها للجودات الأخرى
                await openQualityMenu();
            }

            // الخطوة 2: اختيار الجودة المطلوبة
            await selectQuality(qualityInfo.quality);

            // الخطوة 3: أخذ لقطة شاشة لتوثيق الحالة
            await page.screenshot({ 
                path: path.join(screenshotDir, `servers-loaded-${qualityInfo.quality}p.png`), 
                fullPage: true 
            });

            // الخطوة 4: كشط السيرفرات
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

            console.log(`   🔍 تم العثور على ${rawServers.length} سيرفر خام.`);

            // تصفية وفك التشفير
            let processedServers = [];
            for (const srv of rawServers) {
                if (srv.name.includes('عرب سيد')) continue;
                const cleanIframeUrl = decodeServerLink(srv.raw_link);
                processedServers.push({
                    name: srv.name,
                    quality: srv.quality,
                    iframe_url: cleanIframeUrl,
                    priority: getServerPriority(cleanIframeUrl)
                });
            }

            processedServers.sort((a, b) => a.priority - b.priority);
            processedServers = processedServers.map((srv, index) => ({
                name: `سيرفر ${index + 1}`,
                quality: srv.quality,
                iframe_url: srv.iframe_url
            }));

            movie.qualities.push({
                quality: qualityInfo.quality + 'p',
                title: qualityInfo.title,
                servers_count: processedServers.length,
                servers: processedServers
            });

            console.log(`   ✅ تم معالجة وحفظ ${processedServers.length} سيرفر.`);
        }

        // عرض ملخص النتائج
        console.log('\n📊 ملخص السيرفرات المستخرجة حسب الجودة:');
        movie.qualities.forEach(q => {
            console.log(`\n🎬 الجودة: ${q.quality} - ${q.servers_count} سيرفر`);
            q.servers.forEach(srv => {
                console.log(`   - ${srv.name}: ${srv.iframe_url.substring(0, 50)}...`);
            });
        });

        // حفظ النتائج
        fs.writeFileSync(
            path.join(process.cwd(), 'single_movie_result.json'), 
            JSON.stringify(movie, null, 2), 
            'utf-8'
        );
        console.log(`\n📁 تم حفظ الملف في: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
        await page.screenshot({ 
            path: path.join(screenshotDir, 'error-screenshot.png'), 
            fullPage: true 
        });
        console.log('📸 تم التقاط صورة لحالة الخطأ');
    } finally {
        await browser.close();
        if (recordVideo) {
            console.log('🔴 تم إيقاف تسجيل الفيديو.');
        }
    }
}

scrapeMovies().catch(console.error);
