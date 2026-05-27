const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// دالة فك تشفير روابط الـ Base64
function decodeServerLink(rawLink) {
    if (!rawLink) return '';
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

// دالة تحديد الأولوية للسيرفرات
function getServerPriority(url) {
    if (!url) return 4;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2; 
    if (lowerUrl.includes('voe')) return 3;    
    return 4;                                  
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي وتفعيل تسجيل الفيديو...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    const videoDir = path.join(process.cwd(), 'videos');
    if (!fs.existsSync(videoDir)){
        fs.mkdirSync(videoDir);
    }

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
        recordVideo: {
            dir: 'videos/',
            size: { width: 1920, height: 1080 }
        }
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
        
        movie.extracted_data = {
            default_quality_servers: [],
            high_quality_servers: []
        };

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 جاري الانتقال لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار لفك شيفرة حاوية السيرفرات (الجودة الافتراضية)...');
        await page.waitForTimeout(7000);

        // 1. استخراج سيرفرات الجودة الافتراضية
        console.log('📊 استخراج سيرفرات الجودة الافتراضية أولاً...');
        const rawDefaultServers = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.servers__list ul li')).map(li => ({
                name: li.querySelector('span')?.textContent.trim() || 'سيرفر',
                link: li.getAttribute('data-link')
            }));
        });

        for (let srv of rawDefaultServers) {
            if (srv.name.includes('عرب سيد') || !srv.link) continue;
            const decoded = decodeServerLink(srv.link);
            movie.extracted_data.default_quality_servers.push({
                name: srv.name,
                iframe_url: decoded,
                priority: getServerPriority(decoded)
            });
        }
        movie.extracted_data.default_quality_servers.sort((a, b) => a.priority - b.priority);
        movie.extracted_data.default_quality_servers = movie.extracted_data.default_quality_servers.map((srv, idx) => ({
            name: `سيرفر ${idx + 1}`,
            iframe_url: srv.iframe_url
        }));

        console.log(`✅ تم استخراج (${movie.extracted_data.default_quality_servers.length}) سيرفر للجودة الافتراضية.`);

        // 2. التحويل لأعلى جودة (1080p)
        console.log('⚙️ جاري محاولة فتح قائمة الجودات وتحديد أعلى جودة...');
        const switcherSelector = '.quality__swither.full__767, .quality__swither';
        const isSwitcherVisible = await page.locator(switcherSelector).count();
        
        if (isSwitcherVisible > 0) {
            await page.click(switcherSelector);
            await page.waitForTimeout(1500);

            const targetQualityData = await page.evaluate(() => {
                const liElements = document.querySelectorAll('.qualities__list li');
                let highestQuality = -1;
                let selectorIndex = -1;

                liElements.forEach((li, index) => {
                    const qAttr = li.getAttribute('data-quality');
                    if (qAttr) {
                        const qNum = parseInt(qAttr, 10);
                        if (!isNaN(qNum) && qNum > highestQuality) {
                            highestQuality = qNum;
                            selectorIndex = index;
                        }
                    }
                });
                return { highestQuality, selectorIndex };
            });

            if (targetQualityData.selectorIndex !== -1 && targetQualityData.highestQuality > 0) {
                console.log(`🎯 أعلى جودة تم رصدها هي: ${targetQualityData.highestQuality}p. جاري النقر عليها...`);
                
                const qualityItems = page.locator('.qualities__list li');
                await qualityItems.nth(targetQualityData.selectorIndex).click();
                
                console.log('⏳ جاري الانتظار حتى يستقر هيكل الجودة العالية...');
                await page.waitForTimeout(6000);

                console.log('🎯 بدء كشط السيرفرات بالاعتماد على النقر الفعلي على الهيكل الجديد...');
                const serverElements = page.locator('.servers__list ul li');
                const count = await serverElements.count();

                let tempHighServers = [];

                for (let i = 0; i < count; i++) {
                    const srvLocator = serverElements.nth(i);
                    const serverName = await srvLocator.locator('span').textContent();

                    if (serverName.includes('عرب سيد')) {
                        continue;
                    }

                    console.log(`👇 جاري النقر النشط على: [${serverName.trim()}] لاستخراج رابطه المباشر...`);
                    await srvLocator.click();
                    await page.waitForTimeout(2500);

                    const iframeUrl = await page.evaluate(() => {
                        const iframe = document.querySelector('.watch__player__box iframe, #video_player iframe, iframe');
                        return iframe ? iframe.src : null;
                    });

                    if (iframeUrl && !iframeUrl.includes('about:blank')) {
                        tempHighServers.push({
                            name: serverName.trim(),
                            iframe_url: iframeUrl,
                            priority: getServerPriority(iframeUrl)
                        });
                    }
                }

                tempHighServers.sort((a, b) => a.priority - b.priority);
                movie.extracted_data.high_quality_servers = tempHighServers.map((srv, idx) => ({
                    name: `سيرفر ${idx + 1}`,
                    iframe_url: srv.iframe_url
                }));

                console.log(`✅ تم استخراج (${movie.extracted_data.high_quality_servers.length}) سيرفر للجودة العالية الجديدة.`);
            }
        }

        // اختيار مصفوفة السيرفرات النهائية للحفاظ على الهيكل القديم
        movie.servers = movie.extracted_data.high_quality_servers.length > 0 
            ? movie.extracted_data.high_quality_servers 
            : movie.extracted_data.default_quality_servers;

        // --- البدء في معالجة وحفظ البيانات بملف movies.json المحلي ---
        const moviesFilePath = path.join(process.cwd(), 'movies.json');
        let localMoviesList = [];

        // 1. قراءة البيانات القديمة من ملف movies.json إذا كان موجوداً لمنع المسح العشوائي
        if (fs.existsSync(moviesFilePath)) {
            try {
                const fileContent = fs.readFileSync(moviesFilePath, 'utf-8');
                localMoviesList = JSON.parse(fileContent);
                if (!Array.isArray(localMoviesList)) {
                    localMoviesList = [];
                }
            } catch (parseError) {
                console.log('⚠️ حدث خطأ أثناء قراءة ملف movies.json القديم، سيتم بدء قائمة جديدة.');
                localMoviesList = [];
            }
        }

        // 2. التحقق مما إذا كان الفيلم الحالي مضافاً مسبقاً لمنع التكرار (تحديثه إن وجد، أو إضافته في البداية)
        const existingMovieIndex = localMoviesList.findIndex(m => m.movie_url === movie.movie_url || m.title === movie.title);
        
        if (existingMovieIndex !== -1) {
            console.log('🔄 الفيلم موجود مسبقاً في القائمة المحلية، جاري تحديث بيانات السيرفرات الخاصة به...');
            localMoviesList[existingMovieIndex] = movie;
        } else {
            console.log('➕ فيلم جديد تماماً، جاري إضافته إلى رأس القائمة في ملف movies.json...');
            localMoviesList.unshift(movie); // Unshift تضمن نزوله كأول فيلم بالملف
        }

        // 3. حفظ القائمة الكاملة المحدثة بداخل ملف movies.json المحلي
        fs.writeFileSync(moviesFilePath, JSON.stringify(localMoviesList, null, 2), 'utf-8');
        console.log(`\n📁 تم الحفظ والتحديث بنجاح داخل الملف الرئيسي المجمع: movies.json`);
        
        // للاحتفاظ أيضاً بنسخة الفيلم المنفرد (اختياري)
        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
    } finally {
        await context.close();
        await browser.close();
        console.log('🎬 تم إغلاق المتصفح وحفظ ملف الفيديو بنجاح.');
    }
}

scrapeMovies().catch(console.error);
