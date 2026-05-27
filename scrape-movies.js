const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// الدالة السحرية لفك تشفير روابط الحماية المكشوفة والـ Base64
function decodeServerLink(rawLink) {
    if (!rawLink) return '';
    try {
        let base64String = '';
        if (rawLink.includes('url=')) {
            base64String = rawLink.split('url=')[1];
        } else if (rawLink.includes('id=')) {
            base64String = rawLink.split('id=')[1];
        } else {
            return rawLink; // إذا كان الرابط أصلياً ومكشوفاً بالفعل
        }
        
        // تنظيف الرابط من أي بارامترات إضافية قد تأتي بعد نص الـ Base64
        if (base64String.includes('&')) {
            base64String = base64String.split('&')[0];
        }
        
        return Buffer.from(base64String, 'base64').toString('utf-8');
    } catch (e) {
        return rawLink;
    }
}

// دالة تحديد الأولوية والترتيب بناءً على النطاق الحقيقي النظيف
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

        await page.waitForTimeout(5000);

        const firstMovieUrl = await page.evaluate(() => {
            const linkElement = document.querySelector('li .item__contents a.movie__block');
            return linkElement ? linkElement.href : null;
        });

        if (!firstMovieUrl) {
            console.log('⚠️ فشل استخراج الفيلم الأول من القائمة الرئيسية.');
            return;
        }

        console.log(`\n🎯 تم رصد الفيلم الأول. جاري التوجه لصفحته الرئيسية لاستخراج البيانات الشاملة...`);
        await page.goto(firstMovieUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('📊 جاري كشط تفاصيل الفيلم العامة...');
        const movieDetails = await page.evaluate(() => {
            const title = document.querySelector('.post__name')?.textContent.trim() || '';
            const poster = document.querySelector('.poster-img')?.getAttribute('src') || '';
            const story = document.querySelector('.post__story p')?.textContent.trim() || '';
            
            const infoAreaItems = document.querySelectorAll('.info__area__ul > li');
            const infoData = {};
            
            infoAreaItems.forEach(li => {
                const labelText = li.querySelector('.title__kit span')?.textContent.trim() || '';
                if (labelText.includes('تصنيف')) {
                    infoData.category = Array.from(li.querySelectorAll('.tags__list li a')).map(a => a.textContent.trim());
                } else if (labelText.includes('نوع')) {
                    infoData.genre = Array.from(li.querySelectorAll('.tags__list li a')).map(a => a.textContent.trim());
                } else if (labelText.includes('مدة')) {
                    infoData.duration = li.querySelector('a')?.textContent.trim() || '';
                } else if (labelText.includes('سنة')) {
                    infoData.year = li.querySelector('.tags__list li a')?.textContent.trim() || '';
                } else if (labelText.includes('جودة')) {
                    infoData.quality = li.querySelector('.tags__list li a')?.textContent.trim() || '';
                } else if (labelText.includes('بلد')) {
                    infoData.country = li.querySelector('.tags__list li a')?.textContent.trim() || '';
                } else if (labelText.includes('تاريخ الاضافة')) {
                    infoData.date_added = li.querySelector('a')?.textContent.trim() || '';
                }
            });

            const trailer = document.querySelector('.show__trailer')?.getAttribute('data-iframe') || '';
            const rating = document.querySelector('.rating-average')?.textContent.trim() || '';

            return { title, poster, story, info: infoData, trailer, rating };
        });

        let finalMovieResult = {
            title: movieDetails.title,
            movie_url: firstMovieUrl,
            watch_url: firstMovieUrl.endsWith('/') ? firstMovieUrl + 'watch/' : firstMovieUrl + '/watch/',
            poster: movieDetails.poster,
            story: movieDetails.story,
            details: movieDetails.info,
            trailer: movieDetails.trailer,
            rating: movieDetails.rating,
            qualities: {
                "480p": [],
                "720p": [],
                "1080p": []
            }
        };

        console.log(`🎬 جاري الانتقال لصفحة المشاهدة لبدء فك التشفير واستخراج الجودات...`);
        await page.goto(finalMovieResult.watch_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(6000);

        const targetQualities = ["480", "720", "1080"];

        for (const qKey of targetQualities) {
            console.log(`\n⚙️ محاولة البحث والتنقل لجودة: [${qKey}p]...`);
            
            const switcherSelector = '.quality__swither.full__767, .quality__swither';
            if (await page.locator(switcherSelector).count() > 0) {
                await page.click(switcherSelector);
                await page.waitForTimeout(1000);
            }

            const qualityLiSelector = `.qualities__list li[data-quality="${qKey}"]`;
            const hasQuality = await page.locator(qualityLiSelector).count();

            if (hasQuality > 0) {
                console.log(`🎯 جاري النقر لتوليد هيكل سيرفرات جودة ${qKey}p...`);
                await page.click(qualityLiSelector);
                await page.waitForTimeout(5000); 

                const serverElements = page.locator('.servers__list ul li');
                const count = await serverElements.count();
                let extractedServers = [];

                console.log(`📊 تم رصد (${count}) سيرفر. جاري فك حماية الروابط وتصفيتها برمجياً...`);

                for (let i = 0; i < count; i++) {
                    const srvLocator = serverElements.nth(i);
                    const serverName = await srvLocator.locator('span').textContent();

                    if (serverName.includes('عرب سيد')) continue; 

                    console.log(`   👇 نمر وننقر على: [${serverName.trim()}]...`);
                    await srvLocator.click();
                    await page.waitForTimeout(2500); 

                    // التقاط رابط المشغل الفعال الحالي من الصفحة
                    const rawIframeUrl = await page.evaluate(() => {
                        const iframe = document.querySelector('.watch__player__box iframe, #video_player iframe, iframe');
                        return iframe ? iframe.src : null;
                    });

                    if (rawIframeUrl && !rawIframeUrl.includes('about:blank')) {
                        // كسر وتفكيك الحماية فوراً هنا للحصول على الرابط الأصلي (مثل Vidmoly, Luluvid... إلخ)
                        const cleanRealUrl = decodeServerLink(rawIframeUrl);
                        
                        console.log(`   🔓 تم كسر الحماية بنجاح واستخراج الرابط الأصلي: ${cleanRealUrl}`);
                        
                        extractedServers.push({
                            name: serverName.trim(),
                            iframe_url: cleanRealUrl,
                            priority: getServerPriority(cleanRealUrl) // الترتيب بناءً على النطاق المفتوح الجديد
                        });
                    }
                }

                // ترتيب السيرفرات المفتوحة (Vidmoly أولاً) وإعادة صياغة المظهر النهائي
                extractedServers.sort((a, b) => a.priority - b.priority);
                finalMovieResult.qualities[`${qKey}p`] = extractedServers.map((srv, idx) => ({
                    name: `سيرفر ${idx + 1}`,
                    iframe_url: srv.iframe_url
                }));

                console.log(`✅ انتهى فك وتجميع جودة ${qKey}p بنجاح.`);
            } else {
                console.log(`⏩ جودة ${qKey}p غير متوفرة لهذا الفيلم بالموقع، تم تخطيها.`);
            }
        }

        // حفظ المصفوفة التي تحتوي على فيلم واحد فقط بداخل ملف movies.json المحلي كلياً
        const moviesFilePath = path.join(process.cwd(), 'movies.json');
        fs.writeFileSync(moviesFilePath, JSON.stringify([finalMovieResult], null, 2), 'utf-8');
        
        console.log(`\n📁 تم التحديث الشامل! ملف [movies.json] جاهز ويحتوي على الروابط الأصلية المفتوحة والغير محمية بنجاح 🎯.`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع بالسكريبت:', error);
    } finally {
        await context.close();
        await browser.close();
        console.log('🎬 تم إغلاق المتصفح بنجاح.');
    }
}

scrapeMovies().catch(console.error);
