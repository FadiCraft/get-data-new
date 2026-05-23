const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============ التكوين ============
const CONFIG = {
    BASE_URL: 'https://m.asd.ink',
    CATEGORY_URL: 'https://m.asd.ink/category/arabic-movies-14/',
    OUTPUT_FILE: 'movies.json',
    // تأخير بين الطلبات لتجنب الحظر (بالمللي ثانية)
    DELAY_BETWEEN_MOVIES: 3000,
    DELAY_BETWEEN_PAGES: 5000,
    MAX_RETRIES: 3,
};

// ============ أدوات مساعدة ============
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message, type = 'info') {
    const emojis = {
        info: '📌',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        server: '🖥️',
        movie: '🎬',
    };
    console.log(`${emojis[type] || '•'} ${message}`);
}

// ============ إعداد المتصفح ============
async function createBrowser() {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
        viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    // إخفاء أننا بوت
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
        window.chrome = { runtime: {} };
    });

    // حظر تحميل الموارد غير الضرورية لتسريع العملية
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    return { browser, context, page };
}

// ============ تحميل صفحة مع معالجة Cloudflare ============
async function loadPage(page, url, waitTime = 5000) {
    let retries = CONFIG.MAX_RETRIES;
    
    while (retries > 0) {
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: 60000,
            });
            
            // انتظار إضافي لـ Cloudflare
            await sleep(waitTime);
            
            // تحقق من وجود محتوى حقيقي
            const bodyText = await page.textContent('body');
            if (bodyText.includes('Just a moment') || bodyText.includes('Checking your browser')) {
                log('Cloudflare detected, waiting...', 'warning');
                await sleep(10000);
                retries--;
                continue;
            }
            
            return true;
        } catch (error) {
            log(`Error loading page: ${error.message}`, 'error');
            retries--;
            if (retries > 0) {
                log(`Retrying... (${retries} attempts left)`, 'warning');
                await sleep(5000);
            }
        }
    }
    return false;
}

// ============ استخراج قائمة الأفلام من الصفحة الرئيسية ============
async function extractMoviesList(page) {
    const movies = await page.evaluate(() => {
        const items = document.querySelectorAll('li .item__contents');
        const moviesList = [];

        items.forEach((item) => {
            try {
                const link = item.querySelector('a.movie__block');
                const img = item.querySelector('img');
                const title = item.querySelector('h3');
                const category = item.querySelector('.post__category');
                const genre = item.querySelector('.__genre');
                const quality = item.querySelector('.__quality');
                const description = item.querySelector('.post__info p');

                if (link && title) {
                    moviesList.push({
                        title: title.textContent.trim(),
                        url: link.href,
                        image: img ? img.src : null,
                        image_alt: img ? img.alt : null,
                        category: category ? category.textContent.trim() : null,
                        genre: genre ? genre.textContent.trim() : null,
                        quality: quality ? quality.textContent.trim() : null,
                        description: description ? description.textContent.trim() : null,
                    });
                }
            } catch (e) {
                console.error('Error extracting movie:', e);
            }
        });

        return moviesList;
    });

    return movies;
}

// ============ استخراج تفاصيل فيلم واحد ============
async function extractMovieDetails(page, movieUrl) {
    const loaded = await loadPage(page, movieUrl, 4000);
    if (!loaded) return null;

    const details = await page.evaluate(() => {
        const data = {};

        // ID المنشور
        const likeBtn = document.querySelector('#like__post');
        if (likeBtn) {
            data.post_id = likeBtn.getAttribute('data-id');
        }

        // الرابط المختصر
        const shortlink = document.querySelector('#shortlink');
        if (shortlink) {
            data.shortlink = shortlink.value;
        }

        // عدد المشاهدات
        const viewsCount = document.querySelector('.views__count .like__count');
        if (viewsCount) {
            data.views = parseInt(viewsCount.textContent.trim());
        }

        // عدد الاعجابات
        const likeCount = document.querySelector('#like__post .like__count');
        if (likeCount) {
            data.likes = parseInt(likeCount.textContent.trim());
        }

        // التقييم
        const ratingAvg = document.querySelector('.rating-average');
        const ratingCount = document.querySelector('.rating-count');
        if (ratingAvg) {
            data.rating = ratingAvg.textContent.trim();
        }
        if (ratingCount) {
            data.rating_count = ratingCount.textContent.trim();
        }

        // تاريخ الإضافة
        const dateElement = document.querySelector('.title__kit .fa-calendar-week')?.closest('li');
        if (dateElement) {
            const dateLink = dateElement.querySelector('a');
            if (dateLink) {
                data.date_added = dateLink.textContent.trim();
            }
        }

        // سنة الإصدار
        const yearElement = document.querySelector('a[href*="release-year"]');
        if (yearElement) {
            data.release_year = yearElement.textContent.trim();
        }

        // الجودة (من الصفحة الداخلية)
        const qualityElement = document.querySelector('a[href*="quality"]');
        if (qualityElement) {
            data.quality = qualityElement.textContent.trim();
        }

        // التصنيفات
        const genres = [];
        document.querySelectorAll('a[href*="genre"]').forEach(el => {
            genres.push(el.textContent.trim());
        });
        if (genres.length > 0) {
            data.genres = genres;
        }

        // القصة الكاملة
        const storyElement = document.querySelector('.post__story p');
        if (storyElement) {
            data.full_story = storyElement.textContent.trim();
        }

        // روابط المشاهدة والتحميل
        const watchLink = document.querySelector('a.watch__btn');
        const downloadLink = document.querySelector('a.download__btn');
        if (watchLink) data.watch_url = watchLink.href;
        if (downloadLink) data.download_url = downloadLink.href;

        // صورة البوستر الكبيرة
        const posterImg = document.querySelector('.poster-img');
        if (posterImg) {
            data.poster = posterImg.src;
        }

        return data;
    });

    return details;
}

// ============ استخراج جميع السيرفرات بكل الجودات ============
async function extractAllServers(page, watchUrl) {
    if (!watchUrl) return null;

    // الذهاب لصفحة المشاهدة
    const loaded = await loadPage(page, watchUrl, 4000);
    if (!loaded) {
        log(`Failed to load watch page: ${watchUrl}`, 'error');
        return null;
    }

    // استخراج جميع الجودات المتاحة
    const qualities = await page.evaluate(() => {
        const qualityItems = document.querySelectorAll('.qualities__list li');
        return Array.from(qualityItems).map(item => ({
            quality: item.getAttribute('data-quality'),
            title: item.getAttribute('data-title'),
            isActive: item.classList.contains('active')
        }));
    });

    if (qualities.length === 0) {
        log('No qualities found', 'warning');
        return null;
    }

    log(`Found ${qualities.length} qualities: ${qualities.map(q => q.quality + 'p').join(', ')}`, 'server');

    const allServers = {};

    // استخراج السيرفرات لكل جودة
    for (const quality of qualities) {
        try {
            // النقر على الجودة إذا لم تكن نشطة
            if (!quality.isActive) {
                await page.click(`li[data-quality="${quality.quality}"]`);
                await sleep(2000); // انتظار تحميل السيرفرات
            }

            // استخراج السيرفرات لهذه الجودة
            const servers = await page.evaluate((qu) => {
                const serverItems = document.querySelectorAll(`.servers__list li[data-qu="${qu}"]`);
                return Array.from(serverItems).map(server => ({
                    name: server.querySelector('span') ? server.querySelector('span').textContent.trim() : 'Unknown',
                    server_id: server.getAttribute('data-server'),
                    post_id: server.getAttribute('data-post'),
                    quality: server.getAttribute('data-qu'),
                    link: server.getAttribute('data-link'),
                    is_active: server.classList.contains('active')
                }));
            }, quality.quality);

            allServers[`${quality.quality}p`] = servers;
            log(`  ${quality.quality}p: ${servers.length} servers`, 'server');

        } catch (error) {
            log(`Error extracting servers for ${quality.quality}p: ${error.message}`, 'error');
            allServers[`${quality.quality}p`] = [];
        }
    }

    return {
        qualities_available: qualities.map(q => `${q.quality}p`),
        servers: allServers
    };
}

// ============ الوظيفة الرئيسية ============
async function main() {
    log('Starting movie scraper...', 'info');
    const startTime = Date.now();

    const { browser, context, page } = await createBrowser();

    try {
        // 1. تحميل صفحة الفئة
        log('Loading category page...', 'info');
        const categoryLoaded = await loadPage(page, CONFIG.CATEGORY_URL, 8000);
        
        if (!categoryLoaded) {
            throw new Error('Failed to load category page');
        }

        // تمرير الصفحة لتحميل كل الأفلام
        log('Scrolling to load all movies...', 'info');
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 1500);
            });
        });
        await sleep(3000);

        // 2. استخراج قائمة الأفلام
        log('Extracting movies list...', 'info');
        const moviesList = await extractMoviesList(page);
        log(`Found ${moviesList.length} movies`, 'success');

        if (moviesList.length === 0) {
            throw new Error('No movies found');
        }

        // 3. استخراج تفاصيل كل فيلم وسيرفراته
        const detailedMovies = [];

        for (let i = 0; i < moviesList.length; i++) {
            const movie = moviesList[i];
            log(`[${i + 1}/${moviesList.length}] Processing: ${movie.title}`, 'movie');

            try {
                // استخراج التفاصيل من صفحة الفيلم
                log('  Extracting details...', 'info');
                const details = await extractMovieDetails(page, movie.url);
                
                if (details) {
                    Object.assign(movie, details);
                }

                // استخراج السيرفرات من صفحة المشاهدة
                if (movie.watch_url) {
                    log('  Extracting servers...', 'info');
                    const serversData = await extractAllServers(page, movie.watch_url);
                    if (serversData) {
                        movie.servers = serversData;
                    }
                }

                // إضافة تاريخ الاستخراج
                movie.scraped_at = new Date().toISOString();
                
                detailedMovies.push(movie);
                log(`  Done: ${movie.title}`, 'success');

                // حفظ مؤقت بعد كل فيلم (احتياط)
                fs.writeFileSync(
                    CONFIG.OUTPUT_FILE,
                    JSON.stringify(detailedMovies, null, 2),
                    'utf-8'
                );

                // تأخير بين الأفلام
                if (i < moviesList.length - 1) {
                    await sleep(CONFIG.DELAY_BETWEEN_MOVIES);
                }

            } catch (error) {
                log(`Error processing "${movie.title}": ${error.message}`, 'error');
                // إضافة الفيلم مع البيانات الأساسية فقط
                movie.scraped_at = new Date().toISOString();
                movie.error = error.message;
                detailedMovies.push(movie);
            }
        }

        // 4. حفظ النتائج النهائية
        fs.writeFileSync(
            CONFIG.OUTPUT_FILE,
            JSON.stringify(detailedMovies, null, 2),
            'utf-8'
        );

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✅ Done! Extracted ${detailedMovies.length} movies in ${duration}s`, 'success');
        
        // طباعة ملخص
        console.log('\n📊 Summary:');
        console.log(`Total movies: ${detailedMovies.length}`);
        const moviesWithServers = detailedMovies.filter(m => m.servers).length;
        console.log(`Movies with servers: ${moviesWithServers}`);
        
        const totalServers = detailedMovies.reduce((sum, m) => {
            if (m.servers?.servers) {
                Object.values(m.servers.servers).forEach(s => sum += s.length);
            }
            return sum;
        }, 0);
        console.log(`Total servers extracted: ${totalServers}`);

    } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        // حفظ أي بيانات تم جمعها حتى الآن
        if (fs.existsSync(CONFIG.OUTPUT_FILE)) {
            log('Partial data saved to ' + CONFIG.OUTPUT_FILE, 'warning');
        }
        process.exit(1);
    } finally {
        await browser.close();
    }
}

// تشغيل البرنامج
main().catch(console.error);
