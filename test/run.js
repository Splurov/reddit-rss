'use strict';

var assert = require('assert');

var makeRss = require('../lib/make-rss');
var makeOpml = require('../lib/make-opml');
var fetchNewPosts = require('../lib/fetch-new-posts');
var storageUtils = require('../lib/storage');
var migrateLegacyStorage = require('../lib/migrate-storage');

var posts = [{
    'name': 't3_example',
    'id': 'example',
    'subreddit': 'javascript',
    'title': 'A post.',
    'permalink': '/r/javascript/comments/example/a_post/',
    'created_utc': 1460000000,
    'score': 12,
    'num_comments': 3,
    'is_self': true,
    'selftext_html': null
}];

var testRssAndOpml = function() {
    var emptyRss = makeRss('javascript', []);
    assert(emptyRss.indexOf('<title>reddit / r/javascript</title>') !== -1);
    assert(emptyRss.indexOf('<item>') === -1);

    var rss = makeRss('javascript', posts);
    assert(rss.indexOf('<item>') !== -1);
    assert.strictEqual(posts[0].name, 't3_example');

    var opml = makeOpml([
        {'displayName': 'javascript', 'filename': 'r-javascript.xml'},
        {'displayName': 'node', 'filename': 'r-node.xml'}
    ], 'https://example.com/reddit-rss/rss/');
    assert(opml.indexOf('<opml version="2.0">') !== -1);
    assert(opml.indexOf('xmlUrl="https://example.com/reddit-rss/rss/r-javascript.xml"') !== -1);
    assert(opml.indexOf('htmlUrl="https://www.reddit.com/r/node/"') !== -1);
};

var makePost = function(number) {
    return {
        'name': 't3_new_' + number,
        'created_utc': number
    };
};

var makeSnoowrapItem = function(post) {
    return {
        'toJSON': function() {
            return post;
        }
    };
};

var testNewPostPagination = function() {
    var firstPage = [];
    var requests = [];
    var pageLengths = [];
    var reservedRequests = 0;
    for (var number = 100; number >= 1; number--) {
        firstPage.push(makePost(number));
    }

    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (requests.length === 1) {
                return Promise.resolve(firstPage.map(makeSnoowrapItem));
            }
            if (requests.length === 2) {
                return Promise.resolve([makeSnoowrapItem(makePost(101))]);
            }
            return Promise.resolve([]);
        }
    };

    return fetchNewPosts(reddit, 't3_saved_before', 1000, function() {
        reservedRequests++;
    }, function() {}, function(pageLength) {
        pageLengths.push(pageLength);
    }).then(function(result) {
        assert.strictEqual(reservedRequests, 3);
        assert.deepStrictEqual(requests[0], {'limit': 100, 'before': 't3_saved_before'});
        assert.deepStrictEqual(requests[1], {'limit': 100, 'before': 't3_new_100'});
        assert.deepStrictEqual(requests[2], {'limit': 100, 'before': 't3_new_101'});
        assert.deepStrictEqual(pageLengths, [100, 1, 0]);
        assert.strictEqual(result.posts.length, 101);
        assert.strictEqual(result.before, 't3_new_101');
        assert.strictEqual(result.posts[result.posts.length - 1].name, 't3_new_101');
    });
};

var testRecentPostsAreDeferred = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            return Promise.resolve([
                makeSnoowrapItem(makePost(102)),
                makeSnoowrapItem(makePost(100)),
                makeSnoowrapItem(makePost(99))
            ]);
        }
    };

    return fetchNewPosts(reddit, 't3_saved_before', 100, function() {}, function() {}, function() {}).then(function(result) {
        assert.deepStrictEqual(requests, [{'limit': 100, 'before': 't3_saved_before'}]);
        assert.strictEqual(result.posts.length, 2);
        assert.strictEqual(result.posts[0].name, 't3_new_100');
        assert.strictEqual(result.before, 't3_new_100');
        assert.strictEqual(result.deferredPosts, 1);
    });
};

var testStorageMigration = function() {
    var legacyPosts = [];
    for (var number = 0; number <= 250; number++) {
        legacyPosts.push({
            'name': 't3_legacy_' + number,
            'subreddit': 'JavaScript',
            'created_utc': number
        });
    }
    legacyPosts.push({
        'name': 't3_node',
        'subreddit': 'node',
        'created_utc': 10
    });

    var legacyStorage = {
        'before': 't3_saved_before',
        'posts': legacyPosts
    };
    assert.throws(function() {
        storageUtils.requireCurrentStorage(legacyStorage);
    }, /Legacy storage format/);

    var result = migrateLegacyStorage(legacyStorage);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.storage.before, 't3_saved_before');
    assert.strictEqual(result.storage.posts.javascript.length, 250);
    assert.strictEqual(result.storage.posts.javascript[0].name, 't3_legacy_1');
    assert.strictEqual(result.storage.posts.node[0].name, 't3_node');
    assert.strictEqual(storageUtils.requireCurrentStorage(result.storage), result.storage);
};

testRssAndOpml();
testStorageMigration();
Promise.all([testNewPostPagination(), testRecentPostsAreDeferred()]).then(function() {
    console.log('All tests passed');
}).catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
