import json
import subprocess
import textwrap
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MET_API_PATH = REPO_ROOT / "src" / "api" / "met-api.js"


def run_node(script):
    completed = subprocess.run(
        ["node", "-e", textwrap.dedent(script)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert completed.returncode == 0, (
        "Node 脚本执行失败\n"
        f"STDOUT:\n{completed.stdout}\n"
        f"STDERR:\n{completed.stderr}"
    )


def require_met_api_snippet():
    return json.dumps(str(MET_API_PATH))


def test_prefetch_consumption_does_not_repeat_same_artwork():
    # Given 预取会提前拿到池首 ID
    # When 连续获取三幅作品
    # Then 预取作品只会展示一次
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ MetArtProvider }} = require({require_met_api_snippet()});

        const delay = () => new Promise(resolve => setImmediate(resolve));
        const artwork = id => ({{
          objectID: id,
          title: `Artwork ${{id}}`,
          primaryImage: `https://images.example/${{id}}.jpg`,
          primaryImageSmall: `https://images.example/${{id}}-small.jpg`,
          isPublicDomain: true,
        }});

        (async () => {{
          const provider = new MetArtProvider();
          provider.pool = [301, 302, 303];
          provider.refillPool = async () => {{}};
          provider.fetchArtwork = async id => artwork(id);

          const first = await provider.getNext();
          await delay();
          await delay();

          const second = await provider.getNext();
          await delay();
          await delay();

          const third = await provider.getNext();

          assert.equal(first.id, 301);
          assert.equal(second.id, 302);
          assert.equal(third.id, 303);
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )


def test_consuming_stale_prefetched_artwork_removes_matching_pool_id():
    # Given 旧状态里 prefetched 和 pool 含有同一个 ID
    # When 消费这个预取作品
    # Then 匹配 ID 会从 pool 中清理掉
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ MetArtProvider }} = require({require_met_api_snippet()});

        (async () => {{
          const provider = new MetArtProvider();
          provider.pool = [101, 102];
          provider.refillPool = async () => {{}};
          provider.fetchArtwork = async id => ({{
            objectID: id,
            title: `Artwork ${{id}}`,
            primaryImage: `https://images.example/${{id}}.jpg`,
            isPublicDomain: true,
          }});
          provider.prefetched = {{
            objectID: 101,
            title: 'Prefetched',
            primaryImage: 'https://images.example/101.jpg',
            isPublicDomain: true,
          }};

          const result = await provider.getNext();

          assert.equal(result.id, 101);
          assert.equal(provider.pool.includes(101), false);
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )


def test_concurrent_get_next_does_not_duplicate_ready_prefetch():
    # Given 一个已经就绪的预取作品
    # When 两个 getNext 并发请求下一幅作品
    # Then 两个请求得到不同作品
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ MetArtProvider }} = require({require_met_api_snippet()});

        const delay = () => new Promise(resolve => setImmediate(resolve));
        const artwork = id => ({{
          objectID: id,
          title: `Artwork ${{id}}`,
          primaryImage: `https://images.example/${{id}}.jpg`,
          isPublicDomain: true,
        }});

        (async () => {{
          const provider = new MetArtProvider();
          provider.pool = [801, 802, 803, 804];
          provider.refillPool = async () => {{}};
          provider.fetchArtwork = async id => artwork(id);

          const first = await provider.getNext();
          await delay();
          await delay();

          const [second, third] = await Promise.all([
            provider.getNext(),
            provider.getNext(),
          ]);

          assert.equal(first.id, 801);
          assert.deepEqual(
            [second.id, third.id].sort((left, right) => left - right),
            [802, 803],
          );
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )


def test_refill_pool_deduplicates_existing_displayed_and_repeated_ids():
    # Given 搜索接口返回重复、已入池和已展示的 ID
    # When 补充对象池
    # Then 池内只保留可用且唯一的 ID
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ EventEmitter }} = require('events');
        const https = require('https');
        const {{ MetArtProvider }} = require({require_met_api_snippet()});

        function installJSONResponse(payload) {{
          const originalGet = https.get;
          https.get = (_url, callback) => {{
            const request = new EventEmitter();
            request.destroy = () => {{}};
            request.setTimeout = () => {{}};

            process.nextTick(() => {{
              const response = new EventEmitter();
              response.statusCode = 200;
              callback(response);
              response.emit('data', JSON.stringify(payload));
              response.emit('end');
            }});

            return request;
          }};

          return () => {{
            https.get = originalGet;
          }};
        }}

        (async () => {{
          const provider = new MetArtProvider();
          provider.pool = [502];
          provider.displayedIds.add(503);

          const restore = installJSONResponse({{
            objectIDs: [501, 501, 502, 503, 504],
          }});

          try {{
            await provider.refillPool();
          }} finally {{
            restore();
          }}

          const counts = new Map();
          for (const id of provider.pool) {{
            counts.set(id, (counts.get(id) || 0) + 1);
          }}

          assert.equal(counts.get(501), 1);
          assert.equal(counts.get(502), 1);
          assert.equal(counts.has(503), false);
          assert.equal(counts.get(504), 1);
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )


def test_refill_pool_ignores_malformed_object_id_payloads():
    # Given 搜索接口返回畸形 objectIDs
    # When 补充对象池
    # Then 不抛异常且不污染对象池
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ EventEmitter }} = require('events');
        const https = require('https');
        const {{ MetArtProvider }} = require({require_met_api_snippet()});

        const originalGet = https.get;
        https.get = (_url, callback) => {{
          const request = new EventEmitter();
          request.destroy = () => {{}};
          request.setTimeout = () => {{}};

          process.nextTick(() => {{
            const response = new EventEmitter();
            response.statusCode = 200;
            callback(response);
            response.emit('data', JSON.stringify({{ objectIDs: {{ invalid: true }} }}));
            response.emit('end');
          }});

          return request;
        }};

        (async () => {{
          try {{
            const provider = new MetArtProvider();
            await provider.refillPool();
            assert.deepEqual(provider.pool, []);
          }} finally {{
            https.get = originalGet;
          }}
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )


def test_fetch_json_rejects_large_response_and_destroys_request_once():
    # Given 响应体超过大小限制
    # When fetchJSON 读取响应
    # Then 请求被销毁且 Promise 拒绝为可读错误
    run_node(
        f"""
        const assert = require('assert/strict');
        const {{ EventEmitter }} = require('events');
        const https = require('https');
        const {{ fetchJSON }} = require({require_met_api_snippet()});

        assert.equal(typeof fetchJSON, 'function');

        const originalGet = https.get;
        let destroyCount = 0;

        https.get = (_url, callback) => {{
          const request = new EventEmitter();
          request.destroy = () => {{
            destroyCount += 1;
          }};
          request.setTimeout = () => {{}};

          process.nextTick(() => {{
            const response = new EventEmitter();
            response.statusCode = 200;
            callback(response);
            response.emit('data', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'));
            response.emit('end');
          }});

          return request;
        }};

        (async () => {{
          try {{
            await assert.rejects(
              () => fetchJSON('https://example.test/huge'),
              /Response too large/,
            );
            assert.equal(destroyCount, 1);
          }} finally {{
            https.get = originalGet;
          }}
        }})().catch(error => {{
          console.error(error);
          process.exit(1);
        }});
        """
    )
