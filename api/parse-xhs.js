const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// 辅助函数：下载图片并转成 Base64（绕过防盗链）
async function urlToBase64(imageUrl) {
    try {
        let fixedUrl = imageUrl;
        if (fixedUrl.startsWith('//')) {
            fixedUrl = 'https:' + fixedUrl;
        }

        const response = await axios.get(fixedUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Referer': 'https://www.xiaohongshu.com/'
            },
            timeout: 10000
        });

        const mime = response.headers['content-type'] || 'image/jpeg';
        const base64 = Buffer.from(response.data).toString('base64');
        return {
            url: fixedUrl,
            base64: `data:${mime};base64,${base64}`,
            mime: mime
        };
    } catch (error) {
        console.error(`下载图片失败: ${imageUrl}`, error.message);
        return null;
    }
}

// 解析小红书链接接口
app.post('/api/parse-xhs', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ ok: false, error: '缺少小红书链接' });
        }

        // 1. 模拟手机 UA 抓取小红书 H5 页面
        const htmlResponse = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            maxRedirects: 5,
            timeout: 15000
        });

        const html = htmlResponse.data;

        // 2. 提取 window.__INITIAL_STATE__ JSON 对象
        const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});<\/script>/);
        if (!match) {
            return res.status(500).json({ ok: false, error: '未能从页面中解析到 __INITIAL_STATE__，可能小红书页面结构有变' });
        }

        let rawStateStr = match[1].replace(/\\u002F/g, '/').replace(/undefined/g, 'null');
        const state = JSON.parse(rawStateStr);

        // 3. 兼容不同的路径提取 noteData[cite: 1]
        let noteData = null;
        try {
            noteData = state.noteData?.data?.noteData || state.noteData?.normalNotePreloadData;
        } catch (e) {
            // 容错兜底
        }

        if (!noteData) {
            return res.status(404).json({ ok: false, error: '未能提取到笔记详情数据' });
        }

        const title = noteData.title || noteData.desc?.slice(0, 20) || '无标题';
        const desc = noteData.desc || '';
        const user = noteData.user?.nickname || '未知用户';
        
        // 提取图片列表
        let rawImages = [];
        if (noteData.imageList && Array.isArray(noteData.imageList)) {
            rawImages = noteData.imageList.map(img => img.urlDefault || img.url || img.infoList?.[0]?.url).filter(Boolean);
        }

        // 互动数据
        const likedCount = noteData.interactInfo?.likedCount || '0';
        const commentCount = noteData.interactInfo?.commentCount || '0';
        const collectedCount = noteData.interactInfo?.collectedCount || '0';

        // 4. 批量下载前几张图片并转为 Base64，供 AI 多模态读图[cite: 1]
        const imagesToFetch = rawImages.slice(0, 4); // 限制最多4张防止大模型超限
        const imagePromises = imagesToFetch.map(imgUrl => urlToBase64(imgUrl));
        const processedImages = (await Promise.all(imagePromises)).filter(Boolean);

        return res.json({
            ok: true,
            note: {
                title,
                author: user,
                desc,
                likedCount,
                commentCount,
                collectedCount,
                imageCount: rawImages.length,
                images: processedImages,
                url
            }
        });

    } catch (err) {
        console.error('解析小红书异常:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// 本地测试时使用
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

module.exports = app;
