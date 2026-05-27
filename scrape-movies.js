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

// دالة تحميل الصورة محلياً وتحويلها (أو حفظها) بصيغة PNG
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

        console.log(`📸 جاري تحميل وتحويل البوستر للفيلم: ${movieTitle}`);
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        fs.writeFileSync(localPath, response.data);
        return `posters/${fileName}`; 
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
        await page.waitForTimeout(4000);

        // استخراج روابط كل الأفلام المتواجدة في الصفحة
        const movieUrls = await page.evaluate(() => {
            const links = document.querySelectorAll('li .item__contents a.movie__block');
            return Array.from(links).map(a => a.href);
        });

        console.log(`🎯 تم العثور على (${movieUrls.length}) فيلم في الصفحة. جاري الكشط بالتتابع...`);

        for (const movieUrl of movieUrls) {
            try {
                console.log(`\n🎬 --------------------------------------------------`);
                console.log(`🔄 جاري فتح صفحة الفيلم: ${movieUrl}`);
                await page.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(3000);

                // استخراج تفاصيل الفيلم بصيغة مسطحة (مباشرة تحت بعض)
                const movieDetails = await page.evaluate(() => {
                    const title = document.querySelector('.post__name')?.textContent.trim() || '';
                    const poster = document.querySelector('.poster-img')?.getAttribute('src') || '';
                    const story = document.querySelector('.post__story p')?.textContent.trim() || '';
                    const trailer = document.querySelector('.show__trailer')?.getAttribute('data-iframe') || '';
                    const rating = document.querySelector('.rating-average')?.textContent.trim() || '';
                    
                    const infoAreaItems = document.querySelectorAll('.info__area__ul > li');
                    let category = '';
                    let genre = '';
                    let duration = '';
                    let year = '';
                    let quality = '';
                    let country = '';
                    
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

                // تحميل البوستر محلياً بصيغة PNG
                const localPosterPath = await downloadAndConvertPoster(movieDetails.poster, movieDetails.title);

                // بناء الهيكل النهائي المسطح للفيلم بدون مصفوفات داخلية للسيرفرات
                let currentMovieResult = {
                    title: movieDetails.title,
                    movie_url: movieUrl,
                    poster: localPosterPath,
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
                console.log(`🍿 جاري الانتقال لصفحة المشاهدة لتجميع السيرفرات...`);
                await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.evaluate(() => window.scrollBy(0, 400));
                await page.waitForTimeout(4000);

                const targetQualities = ["480", "720", "1080"];

                for (const qKey of targetQualities) {
                    const switcherSelector = '.quality__swither.full__767, .quality__swither';
                    if (await page.locator(switcherSelector).count() > 0) {
                        await page.click(switcherSelector);
                        await page.waitForTimeout(800);
                    }

                    const qualityLiSelector = `.qualities__list li[data-quality="${qKey}"]`;
                    if (await page.locator(qualityLiSelector).count() > 0) {
                        await page.click(qualityLiSelector);
                        await page.waitForTimeout(3000); 

                        const serverElements = page.locator('.servers__list ul li');
                        const count = await serverElements.count();
                        let extractedServers = [];

                        for (let i = 0; i < count; i++) {
                            const srvLocator = serverElements.nth(i);
                            const serverName = await srvLocator.locator('span').textContent();

                            if (serverName.includes('عرب سيد')) continue; 

                            await srvLocator.click();
                            await page.waitForTimeout(1500); 

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

                        // ترتيب السيرفرات حسب الأولوية المفضلة لديك (مثل Vidmoly أولاً)
                        extractedServers.sort((a, b) => a.priority - b.priority);
                        
                        // هنا يتم الفرد السطحي مباشرة داخل كائن الفيلم الأساسي
                        extractedServers.forEach((srv, idx) => {
                            const serverIndex = idx + 1;
                            // ستظهر هكذا في التطبيق: server_1_1080p_url
                            currentMovieResult[`server_${serverIndex}_${qKey}p_url`] = srv.iframe_url;
                        });
                    }
                }

                allMoviesResults.push(currentMovieResult);
                console.log(`✅ تم الانتهاء من كشط وحفظ فيلم: ${movieDetails.title}`);

            } catch (movieError) {
                console.error(`❌ خطأ أثناء معالجة الفيلم (${movieUrl}):`, movieError.message);
            }
        }

        // حفظ المصفوفة الكاملة لجميع الأفلام في الملف النهائي
        const moviesFilePath = path.join(process.cwd(), 'movies.json');
        fs.writeFileSync(moviesFilePath, JSON.stringify(allMoviesResults, null, 2), 'utf-8');
        
        console.log(`\n🎉 اكتمل العمل بنجاح! تم تحديث ملف [movies.json] بالهيكل المسطح الجديد تماماً.`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع بالسكريبت العام:', error);
    } finally {
        await context.close();
        await browser.close();
        console.log('🎬 تم إغلاق المتصفح.');
    }
}

scrapeMovies().catch(console.error);
