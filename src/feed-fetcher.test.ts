import { describe, expect, test } from "bun:test";
import Parser from "rss-parser";
import { parseFeed } from "./feed-fetcher";

const parser = new Parser();

// RSS 1.0(RDF)形式: 公開日はpubDateではなくdc:dateで持つ
const rdfXml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com/">
    <title>RDFメディア</title>
    <link>https://example.com/</link>
    <description>説明</description>
  </channel>
  <item rdf:about="https://example.com/a">
    <title>RDFの記事</title>
    <link>https://example.com/a</link>
    <description>本文抜粋</description>
    <dc:date>2026-10-23T08:00:00+09:00</dc:date>
  </item>
</rdf:RDF>`;

// RSS 2.0形式: 公開日はpubDateで持つ
const rss2Xml = (pubDate: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS2メディア</title>
    <link>https://example.com/</link>
    <description>説明</description>
    <item>
      <title>RSS2の記事</title>
      <link>https://example.com/b</link>
      <description>本文抜粋</description>
      ${pubDate}
    </item>
  </channel>
</rss>`;

describe("parseFeed", () => {
	test("RSS 1.0(RDF)形式はdc:dateを公開日として読める", async () => {
		const { articles, articlesError } = parseFeed(
			await parser.parseString(rdfXml),
		);
		expect(articlesError).toEqual([]);
		expect(articles.length).toBe(1);
		expect(articles[0]?.pubDate.toISOString()).toBe("2026-10-22T23:00:00.000Z");
		expect(articles[0]?.sourceName).toBe("RDFメディア");
	});

	test("RSS 2.0形式はpubDateを公開日として読める", async () => {
		const { articles, articlesError } = parseFeed(
			await parser.parseString(
				rss2Xml("<pubDate>Thu, 22 Oct 2026 23:00:00 GMT</pubDate>"),
			),
		);
		expect(articlesError).toEqual([]);
		expect(articles[0]?.pubDate.toISOString()).toBe("2026-10-22T23:00:00.000Z");
	});

	test("公開日が無い記事はエラーとして記録する", async () => {
		const { articles, articlesError } = parseFeed(
			await parser.parseString(rss2Xml("")),
		);
		expect(articles).toEqual([]);
		expect(articlesError.length).toBe(1);
		expect(articlesError[0]?.pageName).toBe("RSS2の記事");
	});
});
