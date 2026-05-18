import os
import uuid
from twscrape import API, gather
from models import TransformRequest, TransformResponse, OsintEntity, OsintRelation

# Global API instance
api = API(os.getenv("TWSCRAPE_DB_PATH", "accounts.db"))

async def scrape_twitter(request: TransformRequest) -> TransformResponse:
    username = request.value.replace("@", "").strip().lower()
    
    response = TransformResponse(
        success=False,
        source="twitter",
        entities=[],
        relations=[],
        rawData={},
        error=None
    )

    try:
        # Check if we have any logged-in accounts
        accounts = await api.pool.get_all()
        if len(accounts) == 0:
            response.error = "No Twitter accounts added in twscrape. Please add accounts first using add_accounts endpoint or CLI."
            return response

        if request.transformType in ["profile", "full"]:
            # Fetch user profile
            user = await api.user_by_login(username)
            if not user:
                response.error = f"Twitter user @{username} not found."
                return response

            # === Person Entity ===
            person_id = str(uuid.uuid4())
            person_entity = OsintEntity(
                id=person_id,
                type="person",
                label=user.name or username,
                platform="twitter",
                metadata={
                    "username": user.username,
                    "name": user.name,
                    "bio": getattr(user, 'rawDescription', ''),
                    "location": getattr(user, 'location', ''),
                    "followers": getattr(user, 'followersCount', 0),
                    "following": getattr(user, 'friendsCount', 0),
                    "joined": str(user.created) if hasattr(user, 'created') else None,
                    "verified": getattr(user, 'verified', False),
                    "profile_url": f"https://twitter.com/{user.username}"
                }
            )
            response.entities.append(person_entity)

            # === Twitter Profile Entity ===
            profile_id = str(uuid.uuid4())
            profile_entity = OsintEntity(
                id=profile_id,
                type="twitter_profile",
                label=f"@{user.username}",
                platform="twitter",
                metadata={
                    "user_id": str(user.id),
                    "url": f"https://twitter.com/{user.username}",
                    "profile_image": getattr(user, 'profileImage', None)
                }
            )
            response.entities.append(profile_entity)

            # Relation: Person -> Twitter Profile
            response.relations.append(OsintRelation(
                id=str(uuid.uuid4()),
                sourceId=person_id,
                targetId=profile_id,
                label="HAS_TWITTER"
            ))

            # === Recent Tweets (if full transform) ===
            if request.transformType == "full":
                tweets = await gather(api.user_tweets(user.id, limit=8))
                for tweet in tweets:
                    tweet_id = str(uuid.uuid4())
                    tweet_entity = OsintEntity(
                        id=tweet_id,
                        type="post",
                        label=tweet.rawContent[:60] + "..." if len(tweet.rawContent) > 60 else tweet.rawContent,
                        platform="twitter",
                        metadata={
                            "content": tweet.rawContent,
                            "likes": tweet.likeCount,
                            "retweets": tweet.retweetCount,
                            "replies": tweet.replyCount,
                            "date": str(tweet.date),
                            "tweet_id": str(tweet.id),
                            "url": f"https://twitter.com/{user.username}/status/{tweet.id}"
                        }
                    )
                    response.entities.append(tweet_entity)
                    
                    response.relations.append(OsintRelation(
                        id=str(uuid.uuid4()),
                        sourceId=profile_id,
                        targetId=tweet_id,
                        label="POSTED"
                    ))

            response.success = True
            response.rawData = {
                "username": username, 
                "user_id": str(user.id), 
                "tweets_fetched": len(tweets) if 'tweets' in locals() else 0
            }

    except Exception as e:
        response.error = f"Twitter scrape error: {str(e)}"
        print(f"Twitter error for {username}: {e}")

    return response
