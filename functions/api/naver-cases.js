export async function onRequest(context) {
    const { request } = context;
    const { searchParams } = new URL(request.url);
    const categoryNo = searchParams.get('categoryNo') || '67';
    const blogId = 'juuudy_';

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    try {
        const listUrl = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=${categoryNo}&parentCategoryNo=&countPerPage=5`;
        const listResponse = await fetch(listUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const rawText = await listResponse.text();
        
        const logNos = [...rawText.matchAll(/"logNo":"(\d+)"/g)].map(m => m[1]);
        const titles = [...rawText.matchAll(/"title":"((?:\\"|[^"])*)"/g)].map(m => m[1]);
        const addDates = [...rawText.matchAll(/"addDate":"(.*?)"/g)].map(m => m[1]);

        const listData = { postList: [] };
        const count = Math.min(logNos.length, titles.length, addDates.length);
        for (let i = 0; i < count; i++) {
            listData.postList.push({
                logNo: logNos[i],
                title: titles[i].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), 
                addDate: addDates[i]
            });
        }

        if (listData.postList.length === 0) {
            return new Response(JSON.stringify({ items: [] }), { headers: { ...headers, 'Content-Type': 'application/json' } });
        }

        let rssItems = [];
        try {
            const rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
            const rssResponse = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const rssXml = await rssResponse.text();

            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;
            while ((match = itemRegex.exec(rssXml)) !== null) {
                const itemHtml = match[1];
                const linkMatch = itemHtml.match(/<link>(.*?)<\/link>/);
                const link = linkMatch ? linkMatch[1] : '';
                
                const logNoMatch = link.match(/logNo=(\d+)/) || link.match(/\/(\d+)(?:\?|$)/);
                const logNo = logNoMatch ? logNoMatch[1] : null;

                let description = '';
                const descMatch = itemHtml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) 
                               || itemHtml.match(/<description>([\s\S]*?)<\/description>/);
                
                if (descMatch) {
                    description = descMatch[1].replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim(); 
                }

                if (logNo) {
                    rssItems.push({ logNo, description });
                }
            }
        } catch (e) { console.error('RSS Fetch Error:', e); }

        const fetchFallbackSummary = async (logNo) => {
            try {
                const postUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
                const postRes = await fetch(postUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const html = await postRes.text();
                
                const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
                let content = pMatches.map(m => m[1].replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
                
                if (content && content.length > 20) {
                    return content.length > 200 ? content.substring(0, 200) + '...' : content;
                }
            } catch(e) {}
            return "해당 수임 사례의 전체 진행 과정 및 상세 검토 사항은 온:ON 공식 블로그 원문에서 직접 확인하실 수 있습니다.";
        };

        const itemsWithSummaries = await Promise.all(
            listData.postList.map(async (post) => {
                let decodedTitle = post.title || '';
                try { decodedTitle = decodeURIComponent(post.title.replace(/\+/g, ' ')); } catch (e) { }

                const matchedRss = rssItems.find(r => r.logNo === post.logNo);
                
                let summary = matchedRss && matchedRss.description.length > 10 
                              ? matchedRss.description 
                              : await fetchFallbackSummary(post.logNo);
                
                if (summary.length > 220) summary = summary.substring(0, 220) + '...';

                return {
                    title: decodedTitle,
                    link: `https://blog.naver.com/${blogId}/${post.logNo}`,
                    pubDate: post.addDate || '',
                    description: summary
                };
            })
        );

        return new Response(JSON.stringify({ items: itemsWithSummaries }), { 
            headers: { ...headers, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error('Cloudflare Pages Function Error:', error);
        return new Response(JSON.stringify({ items: [] }), { 
            headers: { ...headers, 'Content-Type': 'application/json' } 
        });
    }
}
