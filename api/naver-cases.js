// api/naver-cases.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const blogId = 'juuudy_';
    const categoryNo = req.query.categoryNo || '67'; 
    
    try {
        // 1. 네이버 블로그 비공개 API (글 번호, 제목 가져오기)
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
            return res.status(200).json({ items: [] });
        }

        // 2. RSS 피드 호출 (최근 글 50개 요약문)
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
                
                // 💡 [핵심 수정] 네이버의 꼬인 주소(?logNo=숫자)에서 완벽하게 글 번호 추출!
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

        // 3. 플랜 B: 모바일 페이지 직접 접속 본문 크롤링 (RSS에 없는 예전 글)
        const fetchFallbackSummary = async (logNo) => {
            try {
                const postUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
                const postRes = await fetch(postUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const html = await postRes.text();
                
                // 본문 <p> 태그나 <span> 태그 텍스트 강제 긁어오기
                const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
                let content = pMatches.map(m => m[1].replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
                
                if (content && content.length > 20) {
                    return content.length > 200 ? content.substring(0, 200) + '...' : content;
                }
            } catch(e) {}
            return "해당 수임 사례의 전체 진행 과정 및 상세 검토 사항은 온:ON 공식 블로그 원문에서 직접 확인하실 수 있습니다.";
        };

        // 4. 데이터 최종 조립
        const itemsWithSummaries = await Promise.all(
            listData.postList.map(async (post) => {
                let decodedTitle = post.title || '';
                try { decodedTitle = decodeURIComponent(post.title.replace(/\+/g, ' ')); } catch (e) { }

                const matchedRss = rssItems.find(r => r.logNo === post.logNo);
                
                // RSS 요약문이 있으면 쓰고, 없으면 모바일에서 긁어온 본문 쓴다!
                let summary = matchedRss && matchedRss.description.length > 10 
                              ? matchedRss.description 
                              : await fetchFallbackSummary(post.logNo);
                
                // 요약문이 너무 길면 자르기
                if (summary.length > 220) summary = summary.substring(0, 220) + '...';

                return {
                    title: decodedTitle,
                    link: `https://blog.naver.com/${blogId}/${post.logNo}`,
                    pubDate: post.addDate || '',
                    description: summary
                };
            })
        );

        return res.status(200).json({ items: itemsWithSummaries });

    } catch (error) {
        console.error('Vercel Serverless Function Error:', error);
        return res.status(200).json({ items: [] });
    }
}
