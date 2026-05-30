const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// دالة فك تشفير روابط الحماية المكشوفة والـ Base64
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
        if (base64String.includes('&')) {
            base64String = base64String.split('&')[0];
        }
        return Buffer.from(base64String, 'base64').toString('utf-8');
    } catch (e) {
        return rawLink;
    }
}

// دالة تحديد الأولوية والترتيب بناءً على النطاق
function getServerPriority(url) {
    if (!url) return 4;
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2; 
    if (lowerUrl.includes('voe')) return 3;    
    return 4;                                   
}

// دالة تحميل الصورة محلياً وتحويلها ورسم رابط GitHub الكامل لها
async function downloadAndConvertPoster(imageUrl, title) {
    if (!imageUrl) return '';
    try {
        const posterDir = path.join(process.cwd(), 'posters');
        if (!fs.existsSync(posterDir)) {
            fs.mkdirSync(posterDir, { recursive: true });
        }

        const safeTitle = title.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
        const fileName = `${safeTitle}_${Date.now()}.png`; 
        const localPath = path.join(posterDir, fileName);

        console.log(`📸 جاري تحميل البوستر لـ: ${title}`);
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 15000
        });

        fs.writeFileSync(localPath, response.data);
        return `https://raw.githubusercontent.com/FadiCraft/get-data-new/main/posters/${fileName}`; 
    } catch (error) {
        console.error(`❌ فشل تحميل صورة (${title}):`, error.message);
        return imageUrl; 
    }
}

// الدالة الأساسية لكشط الرابط (سواء كان فيلم أو حلقة مسلسل)
async function scrapeSingleItem(page, itemUrl) {
    await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const details = await page.evaluate(() => {
        const title = document.querySelector('.post__name')?.textContent.trim() || '';
        const poster = document.querySelector('.poster-img')?.getAttribute('src') || '';
        const story = document.querySelector('.post__story p')?.textContent.trim() || '';
        const trailer = document.querySelector('.show__trailer')?.getAttribute('data-iframe') || '';
        const rating = document.querySelector('.rating-average')?.textContent.trim() || '';
        
        const infoAreaItems = document.querySelectorAll('.info__area__ul > li');
        let category = '', genre = '', duration = '', year = '', quality = '', country = '';
        
        infoAreaItems.forEach(li => {
            const labelText = li.querySelector('.title__kit span')?.textContent.trim() || '';
            if (labelText.includes('تصنيف')) {
                category = Array.from(li.querySelectorAll('.tags__list li a')).map(a => a.textContent.trim()).join(', ');
            } else if (labelText.includes('نوع')) {
                genre = Array.from(li.querySelectorAll('.tags__list li a')).map(a => a.textContent.trim()).join(', ');
            } else if (labelText.includes('مدة')) {
                duration = li.querySelector('a')?.textContent.trim() || '';
            } else if (labelText.includes('سنة')) {
                year = li.querySelector('.tags__list li a')?.textContent.trim() || '';
            } else if (labelText.includes('جودة')) {
                quality = li.querySelector('.tags__list li a')?.textContent.trim() || '';
            } else if (labelText.includes('بلد')) {
                country = li.querySelector('.tags__list li a')?.textContent.trim() || '';
            }
        });

        return { title, poster, story, trailer, rating, category, genre, duration, year, quality, country };
    });

    const githubPosterPath = await downloadAndConvertPoster(details.poster, details.title);

    let resultObject = {
        title: details.title,
        url: itemUrl,
        poster: githubPosterPath,
        story: details.story,
        rating: details.rating,
        trailer: details.trailer,
        category: details.category,
        genre: details.genre,
        duration: details.duration,
        year: details.year,
        quality: details.quality,
        country: details.country
    };

    // الانتقال لصفحة المشاهدة واستخراج السيرفرات والجودات
    const watchUrl = itemUrl.endsWith('/') ? itemUrl + 'watch/' : itemUrl + '/watch/';
    console.log(`🍿 جاري تجميع السيرفرات...`);
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.servers__list', { timeout: 10000 }).catch(() => {});

    const targetQualities = ["480", "720", "1080"];

    for (const qKey of targetQualities) {
        const switcherSelector = '.quality__swither.full__767, .quality__swither';
        if (await page.locator(switcherSelector).count() > 0) {
            await page.click(switcherSelector);
            await page.waitForTimeout(400);
        }

        const qualityLiSelector = `.qualities__list li[data-quality="${qKey}"]`;
        if (await page.locator(qualityLiSelector).count() > 0) {
            await page.click(qualityLiSelector);
            await page.waitForTimeout(1500);

            const serverElements = page.locator('.servers__list ul li');
            const count = await serverElements.count();
            let extractedServers = [];

            for (let i = 0; i < count; i++) {
                const srvLocator = serverElements.nth(i);
                const serverName = await srvLocator.locator('span').textContent();

                if (serverName.includes('عرب سيد')) continue; 

                await srvLocator.click();
                await page.waitForTimeout(800);

                const rawIframeUrl = await page.evaluate(() => {
                    const iframe = document.querySelector('.watch__player__box iframe, #video_player iframe, iframe');
                    return iframe ? iframe.src : null;
                });

                if (rawIframeUrl && !rawIframeUrl.includes('about:blank')) {
                    const cleanRealUrl = decodeServerLink(rawIframeUrl);
                    extractedServers.push({
                        iframe_url: cleanRealUrl,
                        priority: getServerPriority(cleanRealUrl)
                    });
                }
            }

            extractedServers.sort((a, b) => a.priority - b.priority);
            
            extractedServers.forEach((srv, idx) => {
                resultObject[`server_${idx + 1}_${qKey}p_url`] = srv.iframe_url;
            });
        }
    }

    return resultObject;
}

// الدالة الرئيسية لتشغيل المهام كاملة وبشكل تتابعي منظم للأقسام
async function startScrapingSystem() {
    // قائمة الأقسام وروابطها مع تحديد المجلد المستهدف واسم الملف النهائي
    const categories = [
        // --- قسم الأفلام ---
        { type: 'Movies', fileName: 'foreign-movies.json', url: 'https://m.asd.ink/category/foreign-movies-14/' },
        { type: 'Movies', fileName: 'turkish-movies.json', url: 'https://m.asd.ink/category/turkish-movies/' },
        { type: 'Movies', fileName: 'arabic-movies.json', url: 'https://m.asd.ink/category/arabic-movies-14/' },
        { type: 'Movies', fileName: 'dubbed-movies.json', url: 'https://m.asd.ink/category/dubbed-movies/' },
        
        // --- قسم المسلسلات ---
        { type: 'Series', fileName: 'foreign-series.json', url: 'https://m.asd.ink/category/foreign-series-7/' },
        { type: 'Series', fileName: 'turkish-series.json', url: 'https://m.asd.ink/category/turkish-series-2/' },
        { type: 'Series', fileName: 'arabic-series.json', url: 'https://m.asd.ink/category/arabic-series-14/' },
        { type: 'Series', fileName: 'korean-series.json', url: 'https://m.asd.ink/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d9%8a%d9%83%d9%88%d8%b1%d9%8a%d9%87/' },
        { type: 'Series', fileName: 'dubbed-series.json', url: 'https://m.asd.ink/category/dubbed-series/' },
        { type: 'Series', fileName: 'egyptian-series.json', url: 'https://m.asd.ink/category/%d9%85%d8%b3%d9%84%d8%b3%d9%84%d8%a7%d8%aa-%d9%85%d8%b5%d8%b1%d9%8a%d9%87/' }
    ];

    console.log('🚀 جاري تشغيل المتصفح العام...');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh'
    });

    const page = await context.newPage();

    // التأكد من وجود مجلدات الحفظ الرئيسية للمحتوى
    const moviesDir = path.join(process.cwd(), 'Movies');
    const seriesDir = path.join(process.cwd(), 'Series');
    if (!fs.existsSync(moviesDir)) fs.mkdirSync(moviesDir, { recursive: true });
    if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });

    // الدوران حول الأقسام قسماً تلو الآخر
    for (const cat of categories) {
        console.log(`\n📂 ==================================================`);
        console.log(`📂 جاري كشط قسم: [${cat.type} -> ${cat.fileName}]`);
        console.log(`🔗 الرابط: ${cat.url}`);
        console.log(`====================================================`);

        let categoryResults = [];

        try {
            await page.goto(cat.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForSelector('li .item__contents a.movie__block', { timeout: 20000 }).catch(() => {});

            // استخراج روابط العناصر داخل هذا القسم
            const urls = await page.evaluate(() => {
                const links = document.querySelectorAll('li .item__contents a.movie__block');
                return Array.from(links).map(a => a.href);
            });

            console.log(`🎯 تم العثور على (${urls.length}) عنصر في هذا القسم.`);

            // كشط كل رابط تم العثور عليه بشكل تفصيلي
            for (const itemUrl of urls) {
                try {
                    console.log(`\n🎬 جاري معالجة: ${itemUrl}`);
                    const itemData = await scrapeSingleItem(page, itemUrl);
                    categoryResults.push(itemData);
                    console.log(`✅ نجاح الاستخراج لـ: ${itemData.title}`);
                } catch (itemError) {
                    console.error(`❌ خطأ أثناء استخراج الرابط (${itemUrl}):`, itemError.message);
                }
            }

            // تحديد مسار الحفظ النهائي بناءً على نوع القسم (Movies أو Series)
            const targetFolder = cat.type === 'Movies' ? moviesDir : seriesDir;
            const finalFilePath = path.join(targetFolder, cat.fileName);

            // حفظ بيانات القسم بالكامل في ملف الـ JSON الخاص به
            fs.writeFileSync(finalFilePath, JSON.stringify(categoryResults, null, 2), 'utf-8');
            console.log(`\n💾 تم حفظ القسم بنجاح في: ${finalFilePath}`);

        } catch (catError) {
            console.error(`❌ فشل كشط القسم بالكامل (${cat.url}):`, catError.message);
        }
    }

    // إغلاق المتصفح بعد انتهاء كافة الأقسام
    await context.close();
    await browser.close();
    console.log('\n🎉 اكتمل كشط جميع الأقسام (الأفلام والمسلسلات) وإغلاق المتصفح بنجاح!');
}

// بدء السكريبت
startScrapingSystem().catch(console.error);
