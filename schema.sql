-- PlotPost MySQL schema
-- Generated from the Sequelize models in backend/models/*.js
-- Target: MySQL 8.0+ (InnoDB, utf8mb4)
--
-- Notes:
--  * MySQL does not allow literal DEFAULT values on TEXT / JSON columns, so
--    those defaults ('' / [] / {}) are applied by Sequelize in the app, not here.
--  * Defaults computed in JS (e.g. posts.expiresAt = now + 90 days) are also
--    set by the app.
--  * Foreign keys mirror the associations in backend/models/index.js.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `name`                VARCHAR(255) NOT NULL,
  `email`               VARCHAR(255) NOT NULL,
  `password`            VARCHAR(255) NULL,
  `googleId`            VARCHAR(255) NULL,
  `phone`               VARCHAR(255) DEFAULT '',
  `profileImage`        TEXT,
  `bio`                 TEXT,
  `agency`              VARCHAR(255) DEFAULT '',
  `profession`          VARCHAR(255) DEFAULT '',
  `location`            VARCHAR(255) DEFAULT '',
  `role`                ENUM('user','admin') DEFAULT 'user',
  `emailVerifiedAt`     DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `tokenVersion`        INT DEFAULT 0,
  `bannedAt`            DATETIME NULL,
  `banReason`           VARCHAR(255) DEFAULT '',
  `bannedBy`            INT NULL,
  `termsAcceptedAt`     DATETIME NULL,
  `notificationsSeenAt` DATETIME NULL,
  `passwordReset`       JSON NULL,
  `emailVerification`   JSON NULL,
  `accountDeletion`     JSON NULL,
  `settings`            JSON,
  `blockedUsers`        JSON,
  `savedPosts`          JSON,
  `createdAt`           DATETIME NOT NULL,
  `updatedAt`           DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`),
  UNIQUE KEY `users_googleId_unique` (`googleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `posts` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `userId`           INT NOT NULL,
  `title`            VARCHAR(255) DEFAULT '',
  `caption`          TEXT,
  `type`             VARCHAR(255) DEFAULT 'Plot',
  `deal`             VARCHAR(255) DEFAULT 'For sale',
  `price`            VARCHAR(255) DEFAULT '',
  `priceValue`       DOUBLE NULL,
  `location`         VARCHAR(255) DEFAULT '',
  `description`      TEXT,
  `socialUrl`        TEXT,
  `sellerPhone`      VARCHAR(255) DEFAULT '',
  `area`             VARCHAR(255) DEFAULT '',
  `areaValue`        DOUBLE NULL,
  `bedrooms`         VARCHAR(255) DEFAULT '',
  `bedroomsCount`    INT NULL,
  `bathrooms`        VARCHAR(255) DEFAULT '',
  `platform`         VARCHAR(255) DEFAULT 'PlotPost',
  `sellerName`       VARCHAR(255) DEFAULT '',
  `video`            TINYINT(1) DEFAULT 0,
  `videoPublicId`    VARCHAR(255) DEFAULT '',
  `videoUrl`         TEXT,
  `videoPoster`      TEXT,
  `videoDuration`    INT NULL,
  `status`           ENUM('active','sold','rented') DEFAULT 'active',
  `expiresAt`        DATETIME NULL,
  `expiryReminderAt` DATETIME NULL,
  `expiredNoticeAt`  DATETIME NULL,
  `removedAt`        DATETIME NULL,
  `removedReason`    TEXT,
  `removedBy`        INT NULL,
  `sellerBanned`     TINYINT(1) DEFAULT 0,
  `views`            INT DEFAULT 0,
  `stats`            JSON,
  `imageUrl`         TEXT,
  `imageUrls`        JSON,
  `likes`            JSON,
  `comments`         JSON,
  `createdAt`        DATETIME NOT NULL,
  `updatedAt`        DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `posts_userId` (`userId`),
  CONSTRAINT `posts_userId_fk` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `conversations` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `pairKey`       VARCHAR(255) NOT NULL,
  `createdBy`     INT NOT NULL,
  `postId`        INT NULL,
  `participants`  JSON,
  `lastMessage`   JSON,
  `lastMessageAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `unread`        JSON,
  `readAt`        JSON,
  `hiddenAt`      JSON,
  `createdAt`     DATETIME NOT NULL,
  `updatedAt`     DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `conversations_pairKey_unique` (`pairKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `messages` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `conversationId` INT NOT NULL,
  `senderId`       INT NOT NULL,
  `text`           TEXT NOT NULL,
  `postId`         INT NULL,
  `createdAt`      DATETIME NOT NULL,
  `updatedAt`      DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `messages_conversationId` (`conversationId`),
  KEY `messages_senderId` (`senderId`),
  KEY `messages_postId` (`postId`),
  CONSTRAINT `messages_conversationId_fk` FOREIGN KEY (`conversationId`)
    REFERENCES `conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `messages_senderId_fk` FOREIGN KEY (`senderId`)
    REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `messages_postId_fk` FOREIGN KEY (`postId`)
    REFERENCES `posts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- enquiries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `enquiries` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `userId`        INT NULL,
  `sellerUserId`  INT NULL,
  `postId`        INT NULL,
  `postTitle`     VARCHAR(255) NOT NULL,
  `seller`        VARCHAR(255) DEFAULT '',
  `name`          VARCHAR(255) NOT NULL,
  `phone`         VARCHAR(255) NOT NULL,
  `email`         VARCHAR(255) DEFAULT '',
  `message`       TEXT,
  `contactMethod` ENUM('Phone call','WhatsApp','Email') DEFAULT 'Phone call',
  `wantsVisit`    TINYINT(1) DEFAULT 0,
  `status`        ENUM('Pending','Contacted','Closed') DEFAULT 'Pending',
  `readAt`        DATETIME NULL,
  `lastMessageAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `createdAt`     DATETIME NOT NULL,
  `updatedAt`     DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `enquiries_userId` (`userId`),
  KEY `enquiries_sellerUserId` (`sellerUserId`),
  KEY `enquiries_postId` (`postId`),
  CONSTRAINT `enquiries_userId_fk` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `enquiries_sellerUserId_fk` FOREIGN KEY (`sellerUserId`)
    REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `enquiries_postId_fk` FOREIGN KEY (`postId`)
    REFERENCES `posts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `recipient` INT NOT NULL,
  `type`      ENUM('enquiry','comment','like','follow','moderation','listing') NOT NULL,
  `groupKey`  VARCHAR(255) NOT NULL,
  `actors`    JSON,
  `count`     INT DEFAULT 1,
  `post`      INT NULL,
  `enquiry`   INT NULL,
  `actorName` VARCHAR(255) DEFAULT '',
  `preview`   TEXT,
  `commentId` VARCHAR(255) NULL,
  `lastAt`    DATETIME DEFAULT CURRENT_TIMESTAMP,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `notifications_recipient` (`recipient`),
  KEY `notifications_post` (`post`),
  CONSTRAINT `notifications_recipient_fk` FOREIGN KEY (`recipient`)
    REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `notifications_post_fk` FOREIGN KEY (`post`)
    REFERENCES `posts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reports` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `kind`         ENUM('post','comment','user') DEFAULT 'post',
  `post`         INT NULL,
  `comment`      VARCHAR(255) NULL,
  `reportedUser` INT NULL,
  `commentText`  TEXT,
  `reporter`     INT NOT NULL,
  `reason`       VARCHAR(255) NOT NULL,
  `details`      TEXT,
  `status`       ENUM('open','done') DEFAULT 'open',
  `resolvedAt`   DATETIME NULL,
  `resolvedBy`   INT NULL,
  `resolution`   VARCHAR(255) DEFAULT '',
  `createdAt`    DATETIME NOT NULL,
  `updatedAt`    DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `reports_post` (`post`),
  KEY `reports_reporter` (`reporter`),
  KEY `reports_reportedUser` (`reportedUser`),
  CONSTRAINT `reports_reporter_fk` FOREIGN KEY (`reporter`)
    REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `reports_reportedUser_fk` FOREIGN KEY (`reportedUser`)
    REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reports_post_fk` FOREIGN KEY (`post`)
    REFERENCES `posts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- admin_actions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_actions` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `admin`         INT NOT NULL,
  `adminName`     VARCHAR(255) DEFAULT '',
  `action`        ENUM('remove_post','restore_post','remove_comment','ban_user','unban_user','dismiss_reports') NOT NULL,
  `post`          INT NULL,
  `comment`       VARCHAR(255) NULL,
  `user`          INT NULL,
  `summary`       TEXT,
  `reason`        TEXT,
  `reportsClosed` INT DEFAULT 0,
  `createdAt`     DATETIME NOT NULL,
  `updatedAt`     DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- push_devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `push_devices` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `token`      VARCHAR(500) NOT NULL,
  `userId`     INT NOT NULL,
  `platform`   ENUM('android','ios','web') DEFAULT 'android',
  `lastSeenAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `createdAt`  DATETIME NOT NULL,
  `updatedAt`  DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `push_devices_token_unique` (`token`),
  KEY `push_devices_userId` (`userId`),
  CONSTRAINT `push_devices_userId_fk` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `userId`         INT NOT NULL,
  `tokenHash`      VARCHAR(255) NOT NULL,
  `expiresAt`      DATETIME NOT NULL,
  `revokedAt`      DATETIME NULL,
  `replacedByHash` VARCHAR(255) NULL,
  `userAgent`      TEXT,
  `ip`             VARCHAR(255) DEFAULT '',
  `createdAt`      DATETIME NOT NULL,
  `updatedAt`      DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `refresh_tokens_tokenHash_unique` (`tokenHash`),
  KEY `refresh_tokens_userId` (`userId`),
  CONSTRAINT `refresh_tokens_userId_fk` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- post_views
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `post_views` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `postId`    INT NOT NULL,
  `viewer`    VARCHAR(255) NOT NULL,
  `kind`      ENUM('view','call','link','share') NOT NULL,
  `day`       VARCHAR(255) NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `follows` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `follower`  INT NOT NULL,
  `following` INT NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
