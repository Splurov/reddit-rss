'use strict';

var assert = require('assert');

var makeRss = require('../lib/make-rss');
var makeOpml = require('../lib/make-opml');
var fetchNewPosts = require('../lib/fetch-new-posts');
var RedditClient = require('../lib/reddit-client');
var subredditMinRules = require('../lib/min-rules');
var storageUtils = require('../lib/storage');
var nodemailer = require('nodemailer');

var posts = [{
    'name': 't3_example',
    'id': 'example',
    'subreddit': 'javascript',
    'author': 'example_author',
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
    assert(emptyRss.indexOf('<url>https://www.redditstatic.com/shreddit/assets/favicon/192x192.png</url>') !== -1);
    assert(emptyRss.indexOf('<rss version="2.0">\n  <channel>') !== -1);
    assert(emptyRss.endsWith('</rss>\n'));

    var rssWithCommunityIcon = makeRss('javascript', [], 'https://styles.redditmedia.com/icon.png?width=256&amp;s=example');
    assert(rssWithCommunityIcon.indexOf('<url>https://styles.redditmedia.com/icon.png?width=256&amp;s=example</url>') !== -1);

    var rss = makeRss('javascript', posts);
    assert(rss.indexOf('<item>') !== -1);
    assert(rss.indexOf('<author>example_author</author>') !== -1);
    assert(rss.indexOf('<author>javascript</author>') === -1);
    assert.strictEqual(posts[0].name, 't3_example');

    var opml = makeOpml([
        {'displayName': 'javascript', 'filename': 'r-javascript.xml'},
        {'displayName': 'node', 'filename': 'r-node.xml'}
    ], 'https://example.com/reddit-rss/rss/');
    assert(opml.indexOf('<opml version="2.0">') !== -1);
    assert(opml.indexOf('xmlUrl="https://example.com/reddit-rss/rss/r-javascript.xml"') !== -1);
    assert(opml.indexOf('htmlUrl="https://www.reddit.com/r/node/"') !== -1);
    assert(opml.indexOf('  <body>\n    <outline') !== -1);
    assert(opml.endsWith('</opml>\n'));
};

var testDependencyApis = function() {
    var escapedRss = makeRss('node&xml', []);
    assert(escapedRss.indexOf('<title>reddit / r/node&amp;xml</title>') !== -1);

    var rssWithHtml = makeRss('javascript', [{
        'name': 't3_entities',
        'id': 'entities',
        'subreddit': 'javascript',
        'title': 'Quotes: " and \'',
        'permalink': '/r/javascript/comments/entities/entities/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': true,
        'selftext_html': '&lt;p&gt;Fish &amp; chips&lt;/p&gt;'
    }]);
    assert(rssWithHtml.indexOf('Quotes: &quot; and &apos;') !== -1);
    assert(rssWithHtml.indexOf('&lt;p&gt;Fish &amp; chips&lt;/p&gt;') !== -1);

    var rssWithEmbed = makeRss('wallets', [{
        'name': 't3_embed',
        'id': 'embed',
        'subreddit': 'wallets',
        'title': 'Embedded video',
        'permalink': '/r/wallets/comments/embed/embedded_video/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://example.com/video',
        'secure_media_embed': {
            'content': '&lt;iframe src="https://example.com/embed?autoplay=1&amp;amp;api=1"&gt;&lt;/iframe&gt;'
        }
    }]);
    assert(rssWithEmbed.indexOf('&lt;p&gt;&lt;iframe src=&quot;https://example.com/embed?autoplay=1&amp;amp;api=1&quot;&gt;&lt;/iframe&gt;&lt;/p&gt;') !== -1);
    assert(rssWithEmbed.indexOf('&amp;lt;iframe') === -1);

    var rssWithRedditVideo = makeRss('wallets', [{
        'name': 't3_reddit_video',
        'id': 'reddit_video',
        'subreddit': 'wallets',
        'title': 'Reddit video',
        'permalink': '/r/wallets/comments/reddit_video/reddit_video/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'is_reddit_media_domain': true,
        'url': 'https://v.redd.it/reddit-video',
        'media': {
            'reddit_video': {
                'fallback_url': 'https://v.redd.it/reddit-video/video.mp4'
            }
        },
        'preview': {
            'images': [{
                'source': {'url': 'https://preview.redd.it/reddit-video-source.jpg'},
                'resolutions': [{
                    'url': 'https://preview.redd.it/reddit-video-preview.jpg',
                    'width': 640,
                    'height': 360
                }]
            }]
        }
    }]);
    assert(rssWithRedditVideo.indexOf('&lt;video controls preload=&quot;metadata&quot; poster=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot;&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;source src=&quot;https://v.redd.it/reddit-video/video.mp4&quot; type=&quot;video/mp4&quot;/&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;img src=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot; width=&quot;640&quot; height=&quot;360&quot;/&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;p&gt;&lt;img src=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot;') === -1);

    var crosspostWithGallery = {
        'name': 't3_crosspost',
        'id': 'crosspost',
        'subreddit': 'CitiesSkylines2',
        'title': 'Crossposted gallery',
        'permalink': '/r/CitiesSkylines2/comments/crosspost/crossposted_gallery/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://www.reddit.com/gallery/original',
        'selftext_html': null,
        'crosspost_parent_list': [{
            'selftext_html': '&lt;p&gt;Parent description &amp; details&lt;/p&gt;',
            'gallery_data': {
                'items': [{
                    'media_id': 'gallery-image',
                    'caption': 'First & second <third>'
                }]
            },
            'media_metadata': {
                'gallery-image': {
                    'e': 'Image',
                    'p': [{
                        'u': 'https://preview.redd.it/crosspost-gallery.jpg',
                        'x': 1080,
                        'y': 720
                    }]
                }
            }
        }]
    };
    var rssWithCrosspostGallery = makeRss('CitiesSkylines2', [crosspostWithGallery]);
    assert(rssWithCrosspostGallery.indexOf('https://preview.redd.it/crosspost-gallery.jpg') !== -1);
    assert(rssWithCrosspostGallery.indexOf('width=&quot;1080&quot; height=&quot;720&quot;') !== -1);
    assert(rssWithCrosspostGallery.indexOf('&lt;p&gt;First &amp;amp; second &amp;lt;third&amp;gt;&lt;/p&gt;') !== -1);
    assert(rssWithCrosspostGallery.indexOf('&lt;p&gt;Parent description &amp; details&lt;/p&gt;') !== -1);

    crosspostWithGallery.selftext_html = '&lt;p&gt;Crosspost description&lt;/p&gt;';
    var rssWithCrosspostDescription = makeRss('CitiesSkylines2', [crosspostWithGallery]);
    assert(rssWithCrosspostDescription.indexOf('&lt;p&gt;Crosspost description&lt;/p&gt;') !== -1);
    assert(rssWithCrosspostDescription.indexOf('&lt;p&gt;Parent description &amp; details&lt;/p&gt;') === -1);

    var rssWithAnimatedGallery = makeRss('OpenAI', [{
        'name': 't3_animated_gallery',
        'id': 'animated_gallery',
        'subreddit': 'OpenAI',
        'title': 'Animated gallery',
        'permalink': '/r/OpenAI/comments/animated_gallery/animated_gallery/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://www.reddit.com/gallery/animated_gallery',
        'gallery_data': {
            'items': [{
                'media_id': 'animated-image',
                'caption': 'Animated caption'
            }]
        },
        'media_metadata': {
            'animated-image': {
                'e': 'AnimatedImage',
                's': {
                    'mp4': 'https://preview.redd.it/animated-image.mp4',
                    'gif': 'https://i.redd.it/animated-image.gif',
                    'x': 1280,
                    'y': 960
                }
            }
        }
    }]);
    assert(rssWithAnimatedGallery.indexOf('&lt;video autoplay loop muted playsinline preload=&quot;metadata&quot;&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;source src=&quot;https://preview.redd.it/animated-image.mp4&quot; type=&quot;video/mp4&quot;/&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;img src=&quot;https://i.redd.it/animated-image.gif&quot; width=&quot;1280&quot; height=&quot;960&quot;/&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;p&gt;Animated caption&lt;/p&gt;') !== -1);

    var rssWithPoll = makeRss('victorinox', [{
        'name': 't3_poll',
        'id': 'poll',
        'subreddit': 'victorinox',
        'author': 'poll_author',
        'title': 'Choose one',
        'permalink': '/r/victorinox/comments/poll/choose_one/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': true,
        'selftext_html': '&lt;p&gt;Only one survives.&lt;/p&gt;',
        'poll_data': {
            'options': [
                {'id': 'first', 'text': 'Compact & Climber'},
                {'id': 'second', 'text': 'Explorer < SwissChamp'}
            ],
            'total_vote_count': 42
        }
    }]);
    assert(rssWithPoll.indexOf('&lt;p&gt;&lt;strong&gt;Poll — 42 votes&lt;/strong&gt;&lt;/p&gt;') !== -1);
    assert(rssWithPoll.indexOf('&lt;li&gt;Compact &amp;amp; Climber&lt;/li&gt;') !== -1);
    assert(rssWithPoll.indexOf('&lt;li&gt;Explorer &amp;lt; SwissChamp&lt;/li&gt;') !== -1);
    assert(rssWithPoll.indexOf('Vote on Reddit') === -1);

    var originalPost = {
        'name': 't3_original',
        'id': 'original',
        'subreddit': 'originalsub',
        'title': 'Original post',
        'permalink': '/r/originalsub/comments/original/original_post/',
        'created_utc': 1460000000,
        'score': 12,
        'num_comments': 3,
        'is_self': false,
        'url': 'https://example.com/original'
    };
    var crosspost = {
        'name': 't3_crosspost_elsewhere',
        'id': 'crosspost_elsewhere',
        'subreddit': 'crosspostsub',
        'title': 'Crosspost of original',
        'permalink': '/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/',
        'created_utc': 1460000010,
        'score': 8,
        'num_comments': 5,
        'is_self': false,
        'url': 'https://reddit.com/r/originalsub/comments/original/original_post/',
        'crosspost_parent_list': [{
            'id': 'original',
            'subreddit': 'originalsub',
            'permalink': '/r/originalsub/comments/original/original_post/',
            'score': 12,
            'num_comments': 3
        }]
    };
    var postContext = {
        'originalsub': [originalPost],
        'crosspostsub': [crosspost]
    };
    var rssWithOriginalAndCrosspost = makeRss('originalsub', [originalPost], null, postContext);
    var rssWithOnlyCrosspost = makeRss('crosspostsub', [crosspost], null, postContext);
    assert.strictEqual((rssWithOriginalAndCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithOriginalAndCrosspost.indexOf('https://reddit.com/r/originalsub/comments/original/original_post/') !== -1);
    assert(rssWithOriginalAndCrosspost.indexOf('https://reddit.com/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/') !== -1);
    assert(rssWithOriginalAndCrosspost.indexOf('5 — crosspostsub') !== -1);
    assert.strictEqual((rssWithOnlyCrosspost.match(/<item>/g) || []).length, 0);

    var sameLinkPost = {
        'name': 't3_same_link',
        'id': 'same_link',
        'subreddit': 'othersub',
        'title': 'Another post with the same link',
        'permalink': '/r/othersub/comments/same_link/another_post_with_the_same_link/',
        'created_utc': 1460000020,
        'score': 15,
        'num_comments': 2,
        'is_self': false,
        'url': 'https://example.com/original'
    };
    var postContextWithSameLink = {
        'originalsub': [originalPost],
        'othersub': [sameLinkPost],
        'crosspostsub': [crosspost]
    };
    var rssWithSameLinkAndCrosspost = makeRss('originalsub', [originalPost], null, postContextWithSameLink);
    var rssWithSameLinkInOtherSubreddit = makeRss('othersub', [sameLinkPost], null, postContextWithSameLink);
    assert.strictEqual((rssWithSameLinkAndCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/originalsub/comments/original/original_post/') !== -1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/othersub/comments/same_link/another_post_with_the_same_link/') !== -1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/') !== -1);
    assert.strictEqual((rssWithSameLinkInOtherSubreddit.match(/<item>/g) || []).length, 0);

    var unmatchedCrosspost = {
        'name': 't3_unmatched_crosspost',
        'id': 'unmatched_crosspost',
        'subreddit': 'manybaggers',
        'title': 'Crosspost without downloaded parent',
        'permalink': '/r/manybaggers/comments/unmatched_crosspost/crosspost_without_downloaded_parent/',
        'created_utc': 1460000030,
        'score': 4,
        'num_comments': 1,
        'is_self': false,
        'url': '/r/BagBoysClub/comments/missing_parent/source_post/',
        'crosspost_parent_list': [{
            'id': 'missing_parent',
            'subreddit': 'BagBoysClub',
            'permalink': '/r/BagBoysClub/comments/missing_parent/source_post/',
            'score': 4,
            'num_comments': 2
        }]
    };
    var sameUrlUnmatchedCrosspost = {
        'name': 't3_same_url_unmatched_crosspost',
        'id': 'same_url_unmatched_crosspost',
        'subreddit': 'backpacks',
        'title': 'Another crosspost without downloaded parent',
        'permalink': '/r/backpacks/comments/same_url_unmatched_crosspost/another_crosspost_without_downloaded_parent/',
        'created_utc': 1460000040,
        'score': 7,
        'num_comments': 2,
        'is_self': false,
        'url': '/r/BagBoysClub/comments/missing_parent/source_post/',
        'crosspost_parent_list': [{
            'id': 'missing_parent',
            'subreddit': 'BagBoysClub',
            'permalink': '/r/BagBoysClub/comments/missing_parent/source_post/',
            'score': 4,
            'num_comments': 2
        }]
    };
    var unmatchedCrosspostContext = {
        'manybaggers': [unmatchedCrosspost],
        'backpacks': [sameUrlUnmatchedCrosspost]
    };
    var rssWithUnmatchedCrosspost = makeRss('manybaggers', [unmatchedCrosspost], null, unmatchedCrosspostContext);
    var rssWithSameUrlUnmatchedCrosspost = makeRss('backpacks', [sameUrlUnmatchedCrosspost], null, unmatchedCrosspostContext);
    assert.strictEqual((rssWithUnmatchedCrosspost.match(/<item>/g) || []).length, 1);
    assert.strictEqual((rssWithSameUrlUnmatchedCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithUnmatchedCrosspost.indexOf('https://reddit.com/r/backpacks/comments/same_url_unmatched_crosspost/another_crosspost_without_downloaded_parent/') === -1);
    assert(rssWithSameUrlUnmatchedCrosspost.indexOf('https://reddit.com/r/manybaggers/comments/unmatched_crosspost/crosspost_without_downloaded_parent/') === -1);
    assert(rssWithUnmatchedCrosspost.indexOf('https://reddit.com/r/BagBoysClub/comments/missing_parent/source_post/') !== -1);
    assert(rssWithUnmatchedCrosspost.indexOf('2 — BagBoysClub') !== -1);
    assert(rssWithUnmatchedCrosspost.indexOf('crosspost from') === -1);

    var transporter = nodemailer.createTransport('smtp://localhost:2525');
    assert.strictEqual(typeof transporter.sendMail, 'function');
};

var testSubredditMinRules = function() {
    var rulesBySubreddit = subredditMinRules.normalize({
        'r/JavaScript': {'minScore': 20, 'minComments': 5}
    });
    var defaultRules = {'minScore': 7, 'minComments': 12};

    assert.deepStrictEqual(rulesBySubreddit, {
        'javascript': {'minScore': 20, 'minComments': 5}
    });
    assert.strictEqual(subredditMinRules.getForSubreddit(rulesBySubreddit, 'javascript', defaultRules), rulesBySubreddit.javascript);
    assert.strictEqual(subredditMinRules.getForSubreddit(rulesBySubreddit, 'node', defaultRules), defaultRules);
    assert.throws(function() {
        subredditMinRules.normalize({'javascript': {'minScore': 20}});
    }, /minComments is required/);
    assert.throws(function() {
        subredditMinRules.normalize({'javascript': {'minScore': -1, 'minComments': 5}});
    }, /minScore must be a non-negative number/);
};

var testStorageProcessedThrough = function() {
    var legacyStorage = storageUtils.requireCurrentStorage({
        'before': 't3_legacy',
        'posts': {}
    });
    assert.strictEqual(legacyStorage.processedThrough, null);
    assert.strictEqual(legacyStorage.pendingScan, null);

    var currentStorage = storageUtils.requireCurrentStorage({
        'before': null,
        'processedThrough': 100,
        'pendingScan': {
            'after': 't3_resume',
            'scanFrom': 90,
            'targetProcessedThrough': 123
        },
        'posts': {}
    });
    assert.strictEqual(currentStorage.processedThrough, 100);
    assert.strictEqual(currentStorage.pendingScan.after, 't3_resume');

    assert.throws(function() {
        storageUtils.requireCurrentStorage({
            'before': null,
            'processedThrough': '123',
            'posts': {}
        });
    }, /processedThrough must be a non-negative number or null/);

    assert.throws(function() {
        storageUtils.requireCurrentStorage({
            'before': null,
            'processedThrough': 100,
            'pendingScan': {
                'after': '',
                'scanFrom': 90,
                'targetProcessedThrough': 123
            },
            'posts': {}
        });
    }, /pendingScan.after must be a non-empty string/);

    assert.throws(function() {
        storageUtils.requireCurrentStorage({
            'before': null,
            'processedThrough': 100,
            'pendingScan': {
                'after': 't3_resume',
                'scanFrom': 101,
                'targetProcessedThrough': 123
            },
            'posts': {}
        });
    }, /pendingScan has inconsistent time boundaries/);
};

var testRefetchedPostReplacesStoredVersion = function() {
    var storedPosts = storageUtils.sortAndLimitPosts([{
        'name': 't3_refetched',
        'created_utc': 100,
        'score': 5
    }, {
        'name': 't3_other',
        'created_utc': 110,
        'score': 7
    }, {
        'name': 't3_refetched',
        'created_utc': 100,
        'score': 25
    }]);

    assert.strictEqual(storedPosts.length, 2);
    assert.strictEqual(storedPosts[0].name, 't3_refetched');
    assert.strictEqual(storedPosts[0].score, 25);
};

var makePost = function(number) {
    return {
        'name': 't3_new_' + number,
        'created_utc': number
    };
};

var makeListing = function(posts, after) {
    posts.after = after;
    return posts;
};

var testNewPostPagination = function() {
    var requests = [];
    var pageLengths = [];
    var reservedRequests = 0;

    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (!params.after) {
                return Promise.resolve(makeListing([
                    makePost(250),
                    makePost(200),
                    makePost(180)
                ], 't3_after_1'));
            }
            if (params.after === 't3_after_1') {
                return Promise.resolve(makeListing([
                    makePost(120),
                    makePost(91)
                ], 't3_after_2'));
            }
            if (params.after === 't3_after_2') {
                return Promise.resolve(makeListing([
                    makePost(90),
                    makePost(80)
                ], 't3_after_3'));
            }
            if (params.after === 't3_after_3') {
                return Promise.resolve(makeListing([
                    makePost(89),
                    makePost(70)
                ], 't3_unused'));
            }
            throw new Error('Unexpected after: ' + params.after);
        }
    };

    return fetchNewPosts(reddit, 100, 200, 10, function() {
        reservedRequests++;
        return true;
    }, function() {}, function(pageLength) {
        pageLengths.push(pageLength);
    }).then(function(result) {
        assert.strictEqual(reservedRequests, 4);
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'show': 'all'},
            {'limit': 100, 'show': 'all', 'after': 't3_after_1'},
            {'limit': 100, 'show': 'all', 'after': 't3_after_2'},
            {'limit': 100, 'show': 'all', 'after': 't3_after_3'}
        ]);
        assert.deepStrictEqual(pageLengths, [3, 2, 2, 2]);
        assert.deepStrictEqual(result.posts.map(function(post) { return post.created_utc; }), [200, 180, 120, 91, 90]);
        assert.strictEqual(result.deferredPosts, 1);
        assert.strictEqual(result.scanFrom, 90);
        assert.strictEqual(result.processedThrough, 200);
        assert.strictEqual(result.pendingScan, null);
        assert.strictEqual(result.scanCompleted, true);
        assert.strictEqual(result.requestLimitReached, false);
    });
};

var testInitialBackfillScansToListingEnd = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (!params.after) {
                return Promise.resolve(makeListing([makePost(1000), makePost(900)], 't3_older'));
            }
            if (params.after === 't3_older') {
                return Promise.resolve(makeListing([makePost(800)], null));
            }
            throw new Error('Unexpected after: ' + params.after);
        }
    };

    return fetchNewPosts(reddit, null, 1000, 21600, function() {
        return true;
    }, function() {}, function() {}).then(function(result) {
        assert.deepStrictEqual(result.posts.map(function(post) { return post.created_utc; }), [1000, 900, 800]);
        assert.strictEqual(result.scanFrom, null);
        assert.strictEqual(result.processedThrough, 1000);
        assert.strictEqual(result.pendingScan, null);
        assert.strictEqual(result.scanCompleted, true);
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'show': 'all'},
            {'limit': 100, 'show': 'all', 'after': 't3_older'}
        ]);
    });
};

var testNewPostRequestLimitPreservesBoundary = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (!params.after) {
                return Promise.resolve(makeListing([makePost(200), makePost(150)], 't3_second'));
            }
            if (params.after === 't3_second') {
                return Promise.resolve(makeListing([makePost(100), makePost(90)], 't3_third'));
            }
            if (params.after === 't3_third') {
                return Promise.resolve(makeListing([makePost(89)], null));
            }
            throw new Error('Unexpected after: ' + params.after);
        }
    };
    var remainingRequests = 1;

    return fetchNewPosts(reddit, 100, 200, 10, function() {
        if (remainingRequests === 0) {
            return false;
        }
        remainingRequests--;
        return true;
    }, function() {}, function() {}).then(function(firstResult) {
        assert.deepStrictEqual(firstResult.posts.map(function(post) { return post.created_utc; }), [200, 150]);
        assert.strictEqual(firstResult.processedThrough, 100);
        assert.deepStrictEqual(firstResult.pendingScan, {
            'after': 't3_second',
            'scanFrom': 90,
            'targetProcessedThrough': 200
        });
        assert.strictEqual(firstResult.scanCompleted, false);
        assert.strictEqual(firstResult.requestLimitReached, true);

        var persistedPendingScan = JSON.parse(JSON.stringify(firstResult.pendingScan));
        return fetchNewPosts(reddit, firstResult.processedThrough, 250, 10, function() {
            return true;
        }, function() {}, function() {}, persistedPendingScan);
    }).then(function(secondResult) {
        assert.deepStrictEqual(secondResult.posts.map(function(post) { return post.created_utc; }), [100, 90]);
        assert.strictEqual(secondResult.processedThrough, 200);
        assert.strictEqual(secondResult.targetProcessedThrough, 200);
        assert.strictEqual(secondResult.pendingScan, null);
        assert.strictEqual(secondResult.scanCompleted, true);
        assert.strictEqual(secondResult.requestLimitReached, false);
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'show': 'all'},
            {'limit': 100, 'show': 'all', 'after': 't3_second'},
            {'limit': 100, 'show': 'all', 'after': 't3_third'}
        ]);
    });
};

var testRecentPostsAreDeferred = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            return Promise.resolve(makeListing([
                makePost(102),
                makePost(100),
                makePost(99),
                makePost(94)
            ], null));
        }
    };

    return fetchNewPosts(reddit, 95, 100, 0, function() { return true; }, function() {}, function() {}).then(function(result) {
        assert.deepStrictEqual(requests, [{'limit': 100, 'show': 'all'}]);
        assert.strictEqual(result.posts.length, 2);
        assert.strictEqual(result.posts[0].name, 't3_new_100');
        assert.strictEqual(result.posts[1].name, 't3_new_99');
        assert.strictEqual(result.deferredPosts, 1);
        assert.strictEqual(result.processedThrough, 100);
        assert.strictEqual(result.pendingScan, null);
        assert.strictEqual(result.scanCompleted, true);
    });
};

var testRedditClient = function() {
    var requests = [];
    var debugMessages = [];
    var client = new RedditClient({
        'userAgent': 'reddit-rss-test',
        'clientId': 'client-id',
        'clientSecret': 'client-secret',
        'username': 'username',
        'password': 'password',
        'logDebug': function(message) {
            debugMessages.push(message);
        }
    });

    client._request = function(options) {
        requests.push(options);
        if (requests.length === 1) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'token-1', 'expires_in': 3600})
            });
        }
        if (requests.length === 2) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({
                    'data': {
                        'after': 't5_next',
                        'before': null,
                        'children': [{
                            'data': {
                                'name': 't5_javascript',
                                'display_name': 'javascript',
                                'subscribers': 10,
                                'community_icon': 'https://styles.redditmedia.com/icon.png'
                            }
                        }]
                    }
                })
            });
        }
        return Promise.resolve({
            'statusCode': 200,
            'body': JSON.stringify({
                'data': {
                    'after': 't3_next',
                    'before': 't3_previous',
                    'children': [{
                        'data': makePost(1)
                    }]
                }
            })
        });
    };

    return client.getSubscriptions({'limit': 100, 'after': 't5_previous'}).then(function(subscriptions) {
        assert.strictEqual(subscriptions[0].display_name, 'javascript');
        assert.strictEqual(subscriptions[0].community_icon, 'https://styles.redditmedia.com/icon.png');
        assert.strictEqual(subscriptions.after, 't5_next');
        assert.strictEqual(subscriptions.before, null);
        assert.strictEqual(requests[0].hostname, 'www.reddit.com');
        assert.strictEqual(requests[0].path, '/api/v1/access_token');
        assert.strictEqual(requests[0].headers.Authorization, 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=');
        assert.strictEqual(requests[0].body, 'grant_type=password&username=username&password=password');
        assert.strictEqual(requests[1].hostname, 'oauth.reddit.com');
        assert.strictEqual(requests[1].path, '/subreddits/mine/subscriber?limit=100&after=t5_previous');
        assert.strictEqual(requests[1].headers.Authorization, 'Bearer token-1');
        assert.deepStrictEqual(debugMessages, [
            'Request URL {url: https://www.reddit.com/api/v1/access_token}',
            'Request URL {url: https://oauth.reddit.com/subreddits/mine/subscriber?limit=100&after=t5_previous}'
        ]);

        return client.getNew({'limit': 100, 'show': 'all', 'after': 't3_previous'});
    }).then(function(posts) {
        assert.strictEqual(posts[0].name, 't3_new_1');
        assert.strictEqual(posts.after, 't3_next');
        assert.strictEqual(posts.before, 't3_previous');
        assert.strictEqual(requests.length, 3);
        assert.strictEqual(requests[2].path, '/new?limit=100&show=all&after=t3_previous');
        assert.strictEqual(debugMessages[2], 'Request URL {url: https://oauth.reddit.com/new?limit=100&show=all&after=t3_previous}');
    });
};

var testRedditClientRefreshesUnauthorizedToken = function() {
    var requests = [];
    var client = new RedditClient({
        'userAgent': 'reddit-rss-test',
        'clientId': 'client-id',
        'clientSecret': 'client-secret',
        'username': 'username',
        'password': 'password'
    });

    client._request = function(options) {
        requests.push(options);
        if (requests.length === 1) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'expired-token', 'expires_in': 3600})
            });
        }
        if (requests.length === 2) {
            return Promise.resolve({
                'statusCode': 401,
                'body': JSON.stringify({'message': 'Unauthorized'})
            });
        }
        if (requests.length === 3) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'fresh-token', 'expires_in': 3600})
            });
        }
        return Promise.resolve({
            'statusCode': 200,
            'body': JSON.stringify({'data': {'children': []}})
        });
    };

    return client.getNew({'limit': 100}).then(function(posts) {
        assert.strictEqual(posts.length, 0);
        assert.strictEqual(posts.after, null);
        assert.strictEqual(posts.before, null);
        assert.strictEqual(requests.length, 4);
        assert.strictEqual(requests[1].headers.Authorization, 'Bearer expired-token');
        assert.strictEqual(requests[3].headers.Authorization, 'Bearer fresh-token');
    });
};

testRssAndOpml();
testDependencyApis();
testSubredditMinRules();
testStorageProcessedThrough();
testRefetchedPostReplacesStoredVersion();
Promise.all([
    testNewPostPagination(),
    testInitialBackfillScansToListingEnd(),
    testNewPostRequestLimitPreservesBoundary(),
    testRecentPostsAreDeferred(),
    testRedditClient(),
    testRedditClientRefreshesUnauthorizedToken()
]).then(function() {
    console.log('All tests passed');
}).catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
