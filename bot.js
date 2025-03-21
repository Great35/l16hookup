import dotenv from 'dotenv';
import { Telegraf, session, Markup } from 'telegraf';
import { MongoClient } from 'mongodb';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session()); // Enable session middleware

// Connect to MongoDB
const client = new MongoClient(process.env.MONGO_URI);
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        const db = client.db('lemon16_db'); // Update with your database name
        usersCollection = db.collection('users');
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        process.exit(1);
    }
}

connectDB();
const checkSubscriptionExpiry = async () => {
    try {
        const expiredUsers = await usersCollection.find({ 
            subscriptionExpiry: { $lt: new Date() }, 
            isSubscribed: true // Only check active subscribers
        }).toArray();

        for (const user of expiredUsers) {
            try {
                await usersCollection.updateOne(
                    { userId: user.userId }, 
                    { $set: { isSubscribed: false, swipeCount: 20 } } // Reset swipe count
                );

                await bot.telegram.sendMessage(user.userId, "⚠️ Uh-oh, sugar… your premium access just ran out! Don’t miss out on the hottest connections—renew now! 💳");
            } catch (tgError) {
                console.error(`❌ Failed to update subscription or notify user ${user.userId}:`, tgError);
            }
        }
        console.log("✅ Checked and updated expired subscriptions.");
    } catch (error) {
        console.error("❌ Error checking subscription expiry:", error);
    }
};

setInterval(checkSubscriptionExpiry, 24 * 60 * 60 * 1000);

const resetDailySwipes = async () => {
    try {
        await usersCollection.updateMany(
            { isSubscribed: false }, 
            { $set: { swipeCount: 20 } }
        );
        console.log("✅ Daily swipes reset for all free users.");
    } catch (error) {
        console.error("❌ Error resetting daily swipes:", error);
    }
};

// 🟢 Start Command - Begin Onboarding
bot.start(async (ctx) => {
    if (!usersCollection) {
        return ctx.reply("⏳ Whoops! Our database is still waking up. Try again in a sec! ☕");
    }

    const userId = ctx.from.id;
    const existingUser = await usersCollection.findOne({ userId });

    if (existingUser) {
        return sendProfilePreview(ctx, existingUser); // Show profile preview with image
    }

    ctx.session = { userId };
    await ctx.reply("👋 Hey, sexy! Welcome to Lemon16 hoockups🍑   where the chemistry is electric and the nights are unforgettable. 🍋💋    Let’s get you set up. First, what’s your name? 😉");
});

// 🟢 Handle Onboarding Questions in Sequence
bot.on("text", async (ctx) => {
    if (!ctx.session || !ctx.session.userId) return;

    if (!ctx.session.name) {
        ctx.session.name = ctx.message.text;
        return ctx.reply(`Mmm, ${ctx.session.name}... I like it. 😏 Now, tell me your age? (18+ only! No exceptions. 🔥)`);
    }

    if (!ctx.session.age) {
        const age = parseInt(ctx.message.text);
        if (isNaN(age)) return ctx.reply("❌ Oh, honey… that doesn’t look right. Give me your real age. 😉");
        ctx.session.age = age;
        return ctx.reply("Got it! What’s your gender, Love?",
            Markup.inlineKeyboard([
                [Markup.button.callback("🚹 Male", "gender_male"), Markup.button.callback("🚺 Female", "gender_female")],
                [Markup.button.callback("⚧ Other", "gender_other")]
            ])
        );
    }
    
    if (!ctx.session.location) {
        ctx.session.location = ctx.message.text;
        return ctx.reply("Tell me what turns you on… What are your interests? 🔥");
    }

    if (!ctx.session.interests) {
        ctx.session.interests = ctx.message.text;
        return ctx.reply("Who are you craving today? 😏",
            Markup.inlineKeyboard([
                [Markup.button.callback("Men", "interest_men"), Markup.button.callback("Women", "interest_women")],
                [Markup.button.callback("Everyone", "interest_everyone")]
            ])
        );
    }
});

// 🟢 Handle Gender Selection
bot.action(/^gender_(.*)$/, async (ctx) => {
    ctx.session.gender = ctx.match[1];
    await ctx.answerCbQuery();
    return ctx.reply("📍 Hot! Where are you looking to find some fun? (your location 📍) 😘");
});

// 🟢 Handle Interest Selection
bot.action(/^interest_(.*)$/, async (ctx) => {
    ctx.session.interest = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply("📸 Let’s see that **sexiest** profile pic! Show them what they’re missing. 😘");
});

// 🟢 Handle Profile Picture Upload
bot.on("photo", async (ctx) => {
    if (!ctx.session || !ctx.session.userId) return;

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    ctx.session.profilePic = fileId;

    // Save user profile in DB
    const userProfile = {
        userId: ctx.session.userId,
        username: ctx.from.username || "",  // Store Telegram username
        name: ctx.session.name,
        age: ctx.session.age,
        gender: ctx.session.gender,
        location: ctx.session.location,
        interests: ctx.session.interests,
        interestedIn: ctx.session.interest,
        profilePic: ctx.session.profilePic,
        isSubscribed: false,
        swipeCount: 20,
        likedUsers: [],
        dislikedUsers: []
    };
    
    await usersCollection.insertOne(userProfile);
    return sendProfilePreview(ctx, userProfile);
});

// 🔵 Function: Send Profile Preview
async function sendProfilePreview(ctx, user) {
    let profileText = `🔥 Ready to play?:\n\n`;
    profileText += `📛 Name: ${user.name}\n`;
    profileText += `🎂 Age: ${user.age}\n`;
    profileText += `⚧ Gender: ${user.gender}\n`;
    profileText += `📍 Location: ${user.location}\n`;
    profileText += `💡 Turn-ons: ${user.interests}\n`;
    profileText += `💘 Looking For: ${user.interestedIn}\n\n`;


    await ctx.replyWithPhoto(user.profilePic, {
        caption: profileText,
        ...Markup.inlineKeyboard([
             [Markup.button.callback("🔍 Find Your Next Fling", "find_match")],
            [Markup.button.callback("📸 Update Your Sexy Pic", "upload_image")]
        ])
    });
}

// 🟢 Handle Inline Button Clicks
bot.action("find_match", async (ctx) => {
    await ctx.answerCbQuery();let user;
    try {
        user = await usersCollection.findOne({ userId: ctx.from.id });
    } catch (error) {
        console.error("❌ Database Error fetching user:", error);
        return ctx.reply("⚠️ Oops! Something went wrong. Try again later.");
    }
    
    if (!user) return ctx.reply("❌ You need to complete your profile first!");

    const potentialMatches = await usersCollection.find({
        userId: { $ne: user.userId },
        gender: user.interestedIn === "everyone" ? { $in: ["male", "female", "other"] } : user.interestedIn,
        interestedIn: { $in: [user.gender, "everyone"] },
        userId: { $nin: [...user.likedUsers, ...user.dislikedUsers] }
    }).toArray();

    if (potentialMatches.length === 0) {
        return ctx.reply("No new matches available right now. Check back later!");
    }

    const match = potentialMatches[Math.floor(Math.random() * potentialMatches.length)];
    sendMatchProfile(ctx, user, match);
});

// 🔵 Function: Send Match Profile
async function sendMatchProfile(ctx, user, match) {
    let profileText = `💘 Match Found:
📛 Name: ${match.name}
🎂 Age: ${match.age}
📍 Location: ${match.location}
💡 Turn-ons: ${match.interests}`;


    await ctx.replyWithPhoto(match.profilePic, {
        caption: profileText,
        ...Markup.inlineKeyboard([
            [Markup.button.callback("👍 Like", `like_${match.userId}`), Markup.button.callback("👎 Dislike", `dislike_${match.userId}`)]
        ])
    });
}

// 🟢 Handle Like and Dislike Actions
bot.action(/^like_(.*)$/, async (ctx) => {
    const likedUserId = parseInt(ctx.match[1]);
    let user;
    try {
        user = await usersCollection.findOne({ userId: ctx.from.id });
    } catch (error) {
        console.error("❌ Database Error fetching user:", error);
        return ctx.reply("⚠️ Oops! Something went wrong. Try again later.");
    }
    
    if (!user) return;

    if (user.swipeCount <= 0 && !user.isSubscribed) {
        return ctx.reply(
            "🔒 You've reached your daily swipe limit! Upgrade to unlimited swipes.",
            Markup.inlineKeyboard([
                [Markup.button.url("🔥 Upgrade Now", "https://t.me/YourOtherBotUsername")]
            ])
        );
    }
    
    await usersCollection.updateOne(
    { userId: ctx.from.id },
    { $push: { likedUsers: likedUserId }, $inc: { swipeCount: user.isSubscribed ? 0 : -1 } }
);

// Fetch both users
const likedUser = await usersCollection.findOne({ userId: likedUserId });
const currentUser = await usersCollection.findOne({ userId: ctx.from.id });

if (likedUser.likedUsers.includes(ctx.from.id)) {
    let matchMessageForUser = `🎉 *It's a match!* You and *${likedUser.name}* are into each other!`;
    let matchMessageForLikedUser = `🎉 *It's a match!* You and *${currentUser.name}* are into each other!`;

    // Check if the current user is subscribed
    // Show username ONLY if the user is subscribed AND a match is found
if (currentUser.isSubscribed) {
    matchMessageForUser += `\n\n🔗 *Username:* @${likedUser.username}`;
} else {
    matchMessageForUser += `\n\n💎 *Upgrade to premium* to unlock usernames and chat!`;
}

// Add "Upgrade" button for non-subscribed users
const upgradeButton = Markup.inlineKeyboard([
    [Markup.button.url("💎 Upgrade to Premium", "https://t.me/YourPaymentBotUsername")]
]);

// Send match notification with button (if not subscribed)
await ctx.telegram.sendPhoto(
    ctx.from.id,
    likedUser.profilePic,
    {
        caption: matchMessageForUser,
        parse_mode: "Markdown",
        reply_markup: currentUser.isSubscribed ? null : upgradeButton
    }
);


    if (likedUser.isSubscribed) {
        matchMessageForLikedUser += `\n\n🔗 Username: [@${currentUser.username}](tg://user?id=${currentUser.userId})`;
    } else {
        matchMessageForLikedUser += `\n\n💎 *Upgrade to premium* to unlock usernames and chat!`;
    }

    // Buttons
    const chatNowButtonForUser = Markup.inlineKeyboard([
        [Markup.button.url("💬 Chat Now", `tg://user?id=${likedUser.userId}`)]
    ]);

    const chatNowButtonForLikedUser = Markup.inlineKeyboard([
        [Markup.button.url("💬 Chat Now", `tg://user?id=${currentUser.userId}`)]
    ]);

    // Send match notification to both users **with their profile images**
    await ctx.telegram.sendPhoto(
        ctx.from.id,
        likedUser.profilePic,
        {
            caption: matchMessageForUser,
            parse_mode: "Markdown",
            reply_markup: chatNowButtonForUser
        }
    );

    await ctx.telegram.sendPhoto(
        likedUser.userId,
        currentUser.profilePic,
        {
            caption: matchMessageForLikedUser,
            parse_mode: "Markdown",
            reply_markup: chatNowButtonForLikedUser
        }
    );

    // **Auto Find Another Match after 5 seconds**
    setTimeout(async () => {
        await findNextMatch(ctx);
    }, 5000);
}
const matchAttempts = {}; // Track auto-match count for each user

async function findNextMatch(ctx) {
    const userId = ctx.from.id;

    // Initialize or increment auto-match count
    if (!matchAttempts[userId]) {
        matchAttempts[userId] = 0;
    }

    if (matchAttempts[userId] >= 3) {
        // After 3 auto-matches, show button instead
        await ctx.reply("💡 Need more matches? Click below to continue!", {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("🔍 Find Another Match", "find_match")]
            ])
        });

        // Reset the counter for the next session
        matchAttempts[userId] = 0;
        return;
    }

    const currentUser = await usersCollection.findOne({ userId });

    if (!currentUser) {
        return ctx.reply("❌ Error: User not found.");
    }

    // Find a new potential match
    const nextMatch = await usersCollection.findOne({
        userId: { $ne: userId }, // Not the same user
        likedUsers: { $ne: userId } // Not already liked
    });

    if (!nextMatch) {
        return ctx.reply("😢 No more matches available. Try again later!");
    }

    // Show the next match
    await ctx.telegram.sendPhoto(
        userId,
        nextMatch.profilePic,
        {
            caption: `💘 *New Match Suggestion*:\n📛 Name: *${nextMatch.name}*\n🎂 Age: ${nextMatch.age}\n📍 Location: ${nextMatch.location}`,
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❤️ Like", `like_${nextMatch.userId}`)],
                [Markup.button.callback("❌ Dislike", `dislike_${nextMatch.userId}`)]
            ])
        }
    );

    // Increase auto-match count
    matchAttempts[userId]++;
}

});

const userDislikeCounts = {}; // Track dislikes per user

bot.action(/^dislike_(.*)$/, async (ctx) => {
    const dislikedUserId = parseInt(ctx.match[1]);
    const userId = ctx.from.id;

    // Update user's disliked users list
    await usersCollection.updateOne(
        { userId },
        { $push: { dislikedUsers: dislikedUserId } }
    );

    // Get user details
    const currentUser = await usersCollection.findOne({ userId });

    // Track dislikes per user (reset if they start matching again)
    if (!userDislikeCounts[userId]) userDislikeCounts[userId] = 0;
    userDislikeCounts[userId]++;

    if (userDislikeCounts[userId] % 5 === 0 && !currentUser.isSubscribed) {
        // Every 5 dislikes, show an upgrade ad but allow them to continue
        await ctx.reply(
            "🚀 *Tired of swiping?* Unlock premium profiles and see who likes you instantly!",
            {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💎 Upgrade Now", "https://t.me/YourPaymentBot")]
                ])
            }
        );
    }

    if (userDislikeCounts[userId] % 3 === 0) {
        // Every 3 dislikes, show "Find Another Match" button
        return ctx.reply(
            "⚡ You've disliked 3 profiles. Tap below to find another match!",
            Markup.inlineKeyboard([
                [Markup.button.callback("🔍 Find Another Match", "find_match")]
            ])
        );
    }

    // Otherwise, auto-find next match
    ctx.reply("❌ You disliked this profile. Finding another match...");
    await findNextMatch(ctx);
});


// 🚀 Launch the bot
bot.launch().then(() => {
    console.log('🚀 Lemon16 is up and running!');
}).catch((err) => {
    console.error('❌ Error starting bot:', err);
});

// 🛑 Graceful Shutdown
process.once('SIGINT', async () => {
    await client.close();
    bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
    await client.close();
    bot.stop('SIGTERM');
});
