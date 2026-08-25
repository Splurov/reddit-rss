'use strict';

var fetchNewPosts = function(reddit, previousProcessedThrough, maxTime, overlapSeconds, reserveRequest, logDebug, onPage) {
    var newPosts = [];
    var seenPostNames = {};
    var deferredPosts = 0;
    var after = null;
    var seenCursors = {};
    var scanFrom = previousProcessedThrough === null ? null : Math.max(0, previousProcessedThrough - overlapSeconds);

    var makeResult = function(requestLimitReached, scanCompleted) {
        return {
            'posts': newPosts,
            'deferredPosts': deferredPosts,
            'processedThrough': scanCompleted ? maxTime : previousProcessedThrough,
            'requestLimitReached': requestLimitReached,
            'scanCompleted': scanCompleted,
            'scanFrom': scanFrom
        };
    };

    var getPage = function() {
        if (reserveRequest() === false) {
            logDebug('Can not get more new posts {request limit reached; after: ' + (after || 'none') + '}');
            return Promise.resolve(makeResult(true, false));
        }

        var params = {'limit': 100, 'show': 'all'};
        if (after) {
            params.after = after;
        }
        logDebug('Get new posts {after: ' + (after || 'none') + '; scan from: ' + (scanFrom === null ? 'listing start' : scanFrom) + '}');

        return reddit.getNew(params).then(function(items) {
            var page = Array.prototype.slice.call(items);
            var pageNewestTime = null;
            var pageOldestTime = null;
            var matureInPage = 0;
            var deferredInPage = 0;

            onPage(page.length);

            if (page.length === 0) {
                logDebug('Got new-post page {length: 0; finished}');
                return makeResult(false, true);
            }

            page.forEach(function(post) {
                var postTime = Number(post && post.created_utc);
                if (!isFinite(postTime)) {
                    throw new Error('Reddit post is missing created_utc');
                }

                if (pageNewestTime === null || postTime > pageNewestTime) {
                    pageNewestTime = postTime;
                }
                if (pageOldestTime === null || postTime < pageOldestTime) {
                    pageOldestTime = postTime;
                }

                if (postTime > maxTime) {
                    deferredPosts++;
                    deferredInPage++;
                    return;
                }
                if (scanFrom !== null && postTime < scanFrom) {
                    return;
                }

                matureInPage++;
                var postName = post && post.name;
                if (postName && seenPostNames[postName]) {
                    return;
                }
                if (postName) {
                    seenPostNames[postName] = true;
                }
                newPosts.push(post);
            });

            logDebug(
                'Got new-post page {length: ' + page.length +
                '; mature in scan window: ' + matureInPage +
                '; deferred: ' + deferredInPage +
                '; newest: ' + pageNewestTime +
                '; oldest: ' + pageOldestTime + '}'
            );

            if (scanFrom !== null && pageNewestTime < scanFrom) {
                logDebug('Reached completed scan boundary {scan from: ' + scanFrom + '}');
                return makeResult(false, true);
            }

            var nextAfter = items.after;
            if (nextAfter === undefined) {
                nextAfter = page.length < 100 ? null : page[page.length - 1].name;
            }
            if (!nextAfter) {
                logDebug('Reached end of new-post listing');
                return makeResult(false, true);
            }
            if (nextAfter === after || seenCursors[nextAfter]) {
                throw new Error('Can not continue new-post pagination');
            }

            seenCursors[nextAfter] = true;
            after = nextAfter;
            return getPage();
        });
    };

    return getPage();
};

module.exports = fetchNewPosts;
