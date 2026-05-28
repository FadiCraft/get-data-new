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
async function downloadAndConvertPoster(imageUrl, movieTitle) {
    if (!imageUrl) return '';
    try {
        const posterDir = path.join(process.cwd(), 'posters');
        if (!fs.existsSync(posterDir)) {
            fs.mkdirSync(posterDir, { recursive: true });
        }

        const safeTitle = movieTitle.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
        const fileName = `${safeTitle}_${Date.now()}.png`; 
        const localPath = path.join(posterDir, fileName);

        console.log(`📸 جاري تحميل البوستر للفيلم: ${movieTitle}`);
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 15000
        });

        fs.writeFileSync(localPath, response.data);
        
        // الرابط المطلوب المباشر على جيت هاب
        return `https://raw.githubusercontent.com/FadiCraft/get-data-new/main/posters/${fileName}`; 
    } catch (error) {
        console.error(`❌ فشل تحميل صورة الفيلم (${movieTitle}):`, error.message);
        return imageUrl; 
    }
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح...');
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
    let allMoviesResults = [];

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // انتظار تحميل عنصر القائمة لتأكيد وجود الأفلام
        await page.waitForSelector('li .item__contents a.movie__block', { timeout: 20000 });

        const movieUrls = await page.evaluate(() => {
            const links = document.querySelectorAll('li .item__contents a.movie__block');
            return Array.from(links).map(a => a.href);
        });

        console.log(`🎯 تم العثور على (${movieUrls.length}) فيلم. جاري الاستخراج الكامل بالتتابع السريع...`);

        for (const movieUrl of movieUrls) {
            try {
                console.log(`\n🎬 --------------------------------------------------`);
                console.log(`🔄 جاري فتح صفحة الفيلم: ${movieUrl}`);
                await page.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                const movieDetails = await page.evaluate(() => {
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

                const githubPosterPath = await downloadAndConvertPoster(movieDetails.poster, movieDetails.title);

                let currentMovieResult = {
                    title: movieDetails.title,
                    movie_url: movieUrl,
                    poster: githubPosterPath,
                    story: movieDetails.story,
                    rating: movieDetails.rating,
                    trailer: movieDetails.trailer,
                    category: movieDetails.category,
                    genre: movieDetails.genre,
                    duration: movieDetails.duration,
                    year: movieDetails.year,
                    quality: movieDetails.quality,
                    country: movieDetails.country
                };

                // الانتقال لصفحة المشاهدة
                const watchUrl = movieUrl.endsWith('/') ? movieUrl + 'watch/' : movieUrl + '/watch/';
                console.log(`🍿 جاري تجميع السيرفرات والجودات...`);
                await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                
                // انتظار تحميل حاوي المشاهدة الأساسي للتأكد من جاهزية الأكواد
                await page.waitForSelector('.servers__list', { timeout: 15000 }).catch(() => {});

                const targetQualities = ["480", "720", "1080"];

                for (const qKey of targetQualities) {
                    const switcherSelector = '.quality__swither.full__767, .quality__swither';
                    if (await page.locator(switcherSelector).count() > 0) {
                        await page.click(switcherSelector);
                        await page.waitForTimeout(400); // وقت قصير جداً لفتح القائمة المنسدلة
                    }

                    const qualityLiSelector = `.qualities__list li[data-quality="${qKey}"]`;
                    if (await page.locator(qualityLiSelector).count() > 0) {
                        await page.click(qualityLiSelector);
                        await page.waitForTimeout(1500); // انتظار تنفيذ كود السيرفرات للجودة الجديدة بالكامل

                        const serverElements = page.locator('.servers__list ul li');
                        const count = await serverElements.count();
                        let extractedServers = [];

                        for (let i = 0; i < count; i++) {
                            const srvLocator = serverElements.nth(i);
                            const serverName = await srvLocator.locator('span').textContent();

                            if (serverName.includes('عرب سيد')) continue; 

                            await srvLocator.click();
                            await page.waitForTimeout(800); // انتظار استبدال الـ iframe بدون تسرع مفرط يسبب ضياع الرابط

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

                        // ترتيب السيرفرات حسب الأولوية المفضلة
                        extractedServers.sort((a, b) => a.priority - b.priority);
                        
                        // فرد السيرفرات بشكل مسطح داخل كائن الفيلم الأساسي
                        extractedServers.forEach((srv, idx) => {
                            currentMovieResult[`server_${idx + 1}_${qKey}p_url`] = srv.iframe_url;
                        });
                    }
                }

                allMoviesResults.push(currentMovieResult);
                console.log(`✅ تم الانتهاء من استخراج وحفظ فيلم: ${movieDetails.title}`);

            } catch (movieError) {
                console.error(`❌ خطأ أثناء معالجة الفيلم (${movieUrl}):`, movieError.message);
            }
        }

        const moviesFilePath = path.join(process.cwd(), 'movies.json');
        fs.writeFileSync(moviesFilePath, JSON.stringify(allMoviesResults, null, 2), 'utf-8');
        console.log(`\n🎉 اكتمل العمل بنجاح! تم تحديث ملف [movies.json] بكامل البيانات المسطحة.`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع بالسكريبت العام:', error);
    } finally {
        await context.close();
        await browser.close();
        console.log('🎬 تم إغلاق المتصفح.');
    }
}

scrapeMovies().catch(console.error);
