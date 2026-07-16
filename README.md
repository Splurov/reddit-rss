# reddit-rss

reddit-rss generates a separate RSS feed for every subreddit you follow and an OPML subscription containing all feeds.

## Installation

* `npm install`
* `cp config.json.example config.json`
* `cp storage.json.example storage.json`
* edit `config.json` with your preferences, Reddit credentials and public URLs
* run: `node index.js`
* set up crontab for regular updates

## Output

`rssDirectoryPath` contains one XML file per subscribed subreddit, including valid empty feeds for subreddits without posts. `opmlFilePath` contains the OPML subscription.

`rssPublicBaseUrl` must be the public URL for `rssDirectoryPath`, and `opmlPublicUrl` must be the public URL for `opmlFilePath`; RSS clients use these URLs, not local file paths.

The first successful run creates the OPML and a cache of subscriptions. Later, when subscriptions change, the script creates or removes RSS files, rewrites the OPML and sends one notification to `mailTo`. If subscriptions do not change, the OPML is left untouched.

## Migration

`rssFilePath` and `maxRssItems` are no longer used. Add the new RSS, OPML and subscription-cache paths from `config.json.example` to an existing `config.json`. Then run `node migrate-storage.js` once before running `node index.js`.

The migration creates `storage.json.legacy-backup`, converts the old `storage.posts` array into separate per-subreddit lists and keeps at most 250 posts in each list. The main script does not support the old storage format and will tell you to run the migration if it finds one. `maxRequests` limits only the number of Reddit pages fetched for new posts; loading the full subscription list does not consume this limit.
 
## Links

* https://ssl.reddit.com/prefs/apps
* http://www.reddit.com/dev/api

## To-do

* http://embed.ly/docs/embed/api/endpoints/1/oembed
