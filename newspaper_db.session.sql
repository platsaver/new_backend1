CREATE TABLE Users (
    UserID SERIAL PRIMARY KEY,
    UserName VARCHAR(255) NOT NULL,
    Role VARCHAR(50) NOT NULL,
    Password VARCHAR(255) NOT NULL,
    Email VARCHAR(255) UNIQUE NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAtDate TIMESTAMP DEFAULT NULL
);
ALTER TABLE Users ADD COLUMN PlainPassword VARCHAR(255);
ALTER TABLE Users
ALTER COLUMN Role SET DEFAULT 'nguoidung';
ALTER TABLE Users ADD COLUMN AvatarURL VARCHAR(255) DEFAULT NULL;

CREATE TABLE Categories (
    CategoryID SERIAL PRIMARY KEY,
    CategoryName VARCHAR(255) NOT NULL,
    UNIQUE (CategoryName)
);
CREATE TABLE SubCategories (
    SubCategoryID SERIAL PRIMARY KEY,
    CategoryID INT NULL,
    SubCategoryName VARCHAR(255) NOT NULL,
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID) ON DELETE CASCADE,
    UNIQUE (CategoryID, SubCategoryName)
);
ALTER TABLE Categories
ADD COLUMN BannerURL TEXT;

ALTER TABLE SubCategories
ADD COLUMN BannerURL TEXT;

CREATE TABLE Posts (
    PostID SERIAL PRIMARY KEY,
    UserID INT NOT NULL,
    CategoryID INT, -- Thêm cột CategoryID
    SubCategoryID INT, -- Thêm cột SubCategoryID
    Title VARCHAR(255) NOT NULL,
    Content TEXT NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAtDate TIMESTAMP DEFAULT NULL,
    Status VARCHAR(50) NOT NULL DEFAULT 'Draft',
    Featured BOOLEAN DEFAULT FALSE,
    --slug VARCHAR(255) UNIQUE,
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID) ON DELETE SET NULL,
    FOREIGN KEY (SubCategoryID) REFERENCES SubCategories(SubCategoryID) ON DELETE SET NULL
);
CREATE TABLE Comments (
    CommentID SERIAL PRIMARY KEY,
    PostID INT NOT NULL,
    UserID INT NOT NULL,
    Content TEXT NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAtDate TIMESTAMP DEFAULT NULL,
    Status VARCHAR(20) DEFAULT 'pending',
    ModerationNote TEXT,
    ModeratorID INT REFERENCES Users(UserID),
    FOREIGN KEY (PostID) REFERENCES Posts(PostID) ON DELETE CASCADE,
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
);

CREATE TABLE PostTags (
    PostID INT NULL,
    TagID INT NULL,
    PRIMARY KEY (PostID, TagID),
    FOREIGN KEY (PostID) REFERENCES Posts(PostID) ON DELETE CASCADE,
    FOREIGN KEY (TagID) REFERENCES Tags(TagID) ON DELETE CASCADE
);

CREATE TABLE Tags (
    TagID SERIAL PRIMARY KEY,
    TagName VARCHAR(100) UNIQUE NOT NULL
);
/*1 post có thể sở hữu nhiều media, nhưng 1 media chỉ có thể thuộc về 1 post*/
CREATE TABLE Media (
    MediaID SERIAL PRIMARY KEY,
    PostID INT NULL,
    MediaURL TEXT NOT NULL,
    MediaType VARCHAR(50) NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (PostID) REFERENCES Posts(PostID) ON DELETE CASCADE
);
select * from media
/*Trigger*/
-- Trigger ghi lại thời gian cập nhật bài viết
-- Tạo hàm trigger
CREATE OR REPLACE FUNCTION update_post_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.UpdatedAtDate = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tạo trigger
CREATE TRIGGER trigger_update_post_timestamp
BEFORE UPDATE ON Posts
FOR EACH ROW
EXECUTE FUNCTION update_post_timestamp();

-- Xóa trigger và hàm trigger AFTER INSERT
DROP TRIGGER IF EXISTS trigger_set_display_order_after_insert ON Posts;
DROP FUNCTION IF EXISTS set_display_order_after_insert;

-- Xóa trigger và hàm trigger AFTER DELETE
DROP TRIGGER IF EXISTS trigger_reorder_posts_display_order ON Posts;
DROP FUNCTION IF EXISTS reorder_posts_display_order;

-- Xóa cột DisplayOrder
ALTER TABLE Posts
DROP COLUMN IF EXISTS DisplayOrder;

-- Hàm trigger để gán quyền khi tạo tài khoản mới
CREATE OR REPLACE FUNCTION assign_user_role_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Tạo user PostgreSQL với mật khẩu gốc
  IF NEW.PlainPassword IS NOT NULL THEN
    EXECUTE format('CREATE USER %I WITH PASSWORD %L', NEW.UserName, NEW.PlainPassword);
    EXECUTE format('GRANT CONNECT ON DATABASE newspaper_db TO %I', NEW.UserName);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', NEW.UserName);
  ELSE
    RAISE EXCEPTION 'PlainPassword is required to create PostgreSQL user for %', NEW.UserName;
  END IF;

  -- Gán quyền dựa trên giá trị cột Role
  IF NEW.Role = 'author' THEN
    EXECUTE format('GRANT author TO %I', NEW.UserName);
  ELSIF NEW.Role = 'admin' THEN
    EXECUTE format('GRANT admin TO %I', NEW.UserName);
  ELSIF NEW.Role = 'nguoidung' THEN
    EXECUTE format('GRANT nguoidung TO %I', NEW.UserName);
  ELSE
    RAISE NOTICE 'Role % không hợp lệ, không gán quyền', NEW.Role;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Lỗi khi tạo user hoặc gán quyền cho %: %', NEW.UserName, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Trigger để gán quyền khi tạo tài khoản
DROP TRIGGER IF EXISTS trigger_assign_user_role_on_insert ON Users;
CREATE TRIGGER trigger_assign_user_role_on_insert
AFTER INSERT ON Users
FOR EACH ROW
EXECUTE FUNCTION assign_user_role_on_insert();

select * from users
DROP OWNED BY testuser1;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM testuser1;
REVOKE ALL ON SCHEMA public FROM testuser1;
DROP USER testuser1;
select * from users
-- Trigger tự động phân lại quyền
-- Trigger tự động phân lại quyền
-- Updated function to sync role changes with PostgreSQL role privileges
CREATE OR REPLACE FUNCTION sync_user_role()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the user exists in PostgreSQL
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = NEW.UserName) THEN
        RAISE EXCEPTION 'User % does not exist in PostgreSQL', NEW.UserName;
    END IF;

    -- Update timestamp
    NEW.UpdatedAtDate = CURRENT_TIMESTAMP;

    -- Revoke only irrelevant roles based on new Role
    IF NEW.Role = 'author' THEN
        EXECUTE format('REVOKE admin, nguoidung FROM %I', NEW.UserName);
        EXECUTE format('GRANT author TO %I', NEW.UserName);
    ELSIF NEW.Role = 'admin' THEN
        EXECUTE format('REVOKE author FROM %I', NEW.UserName);
        EXECUTE format('GRANT admin, nguoidung TO %I', NEW.UserName); -- Grant both admin and nguoidung
    ELSIF NEW.Role = 'nguoidung' THEN
        EXECUTE format('REVOKE author, admin FROM %I', NEW.UserName);
        EXECUTE format('GRANT nguoidung TO %I', NEW.UserName);
    ELSE
        RAISE EXCEPTION 'Invalid role: %', NEW.Role;
    END IF;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error syncing role for user %: %', NEW.UserName, SQLERRM;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION sync_user_role() OWNER TO postgres;

-- Drop existing trigger if it exists (để đảm bảo sạch)
DROP TRIGGER IF EXISTS sync_role_trigger ON Users;

-- Create trigger to execute the function before updating the Role column
CREATE TRIGGER sync_role_trigger
BEFORE UPDATE OF Role ON Users
FOR EACH ROW
WHEN (OLD.Role IS DISTINCT FROM NEW.Role)
EXECUTE FUNCTION sync_user_role();

select * from users
UPDATE Users SET Role = 'nguoidung' WHERE UserName = 'testuser';
EXPLAIN UPDATE Users SET Role = 'admin' WHERE UserName = 'testuser';
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'sync_user_role';
SELECT UserName, Role FROM Users WHERE UserName = 'testuser';

-- Trigger tự động cập nhật sql login mỗi khi thay đổi username hay password
-- Hàm trigger để đồng bộ role PostgreSQL với UserName và PlainPassword
CREATE OR REPLACE FUNCTION sync_role_with_users()
RETURNS TRIGGER AS $$
BEGIN
  -- Nếu UserName thay đổi, đổi tên role
  IF OLD.UserName IS DISTINCT FROM NEW.UserName THEN
    EXECUTE format('ALTER ROLE %I RENAME TO %I', OLD.UserName, NEW.UserName);
  END IF;

  -- Nếu PlainPassword thay đổi, cập nhật mật khẩu role
  IF OLD.PlainPassword IS DISTINCT FROM NEW.PlainPassword THEN
    EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', NEW.UserName, NEW.PlainPassword);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists to avoid conflicts
DROP TRIGGER IF EXISTS sync_credentials_trigger ON Users;

-- Trigger với tên mới để kích hoạt hàm trên khi cập nhật UserName hoặc PlainPassword
CREATE TRIGGER sync_credentials_trigger
AFTER UPDATE OF UserName, PlainPassword ON Users
FOR EACH ROW
WHEN (OLD.UserName IS DISTINCT FROM NEW.UserName OR OLD.PlainPassword IS DISTINCT FROM NEW.PlainPassword)
EXECUTE FUNCTION sync_role_with_users();
select * from users
/*Phân quyền và thu hồi quyền (khi cần)*/
CREATE ROLE author;
CREATE ROLE admin;
CREATE ROLE nguoidung;
-- adminPhân quyền
GRANT ALL PRIVILEGES ON DATABASE newspaper_db TO admin;
GRANT SELECT, UPDATE, DELETE ON TABLE Users TO admin;
-- author 
GRANT SELECT ON Users, Posts, Comments, Categories, SubCategories, Tags, PostTags TO author;
GRANT INSERT, UPDATE, DELETE ON Posts TO author;
GRANT INSERT, UPDATE, DELETE ON Comments TO author;
GRANT INSERT ON Tags TO author;
GRANT INSERT, DELETE ON PostTags TO author;
-- nguoidung
GRANT SELECT ON Posts TO nguoidung;
GRANT SELECT, INSERT, UPDATE, DELETE ON Comments TO nguoidung;
-- Grant sequence to author and admin
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO author;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin;
GRANT USAGE, SELECT ON SEQUENCE Comments_CommentID_seq TO nguoidung;
-- Bật RLS trên Posts
ALTER TABLE Posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE Posts FORCE ROW LEVEL SECURITY; -- Buộc tất cả user (trừ owner) tuân theo RLS

-- Policy cho SELECT trên Posts (xem tất cả)
CREATE POLICY select_posts ON Posts
  FOR SELECT
  TO author
  USING (true);

-- Policy cho INSERT trên Posts (gán UserID của author)
CREATE POLICY insert_posts ON Posts
  FOR INSERT
  TO author
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Posts (chỉ sửa của mình)
CREATE POLICY update_posts ON Posts
  FOR UPDATE
  TO author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Posts (chỉ xóa của mình)
CREATE POLICY delete_posts ON Posts
  FOR DELETE
  TO author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Bật RLS trên Comments
ALTER TABLE Comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE Comments FORCE ROW LEVEL SECURITY;

-- Policy cho SELECT trên Comments (xem tất cả)
CREATE POLICY select_comments ON Comments
  FOR SELECT
  TO author
  USING (true);

-- Policy cho INSERT trên Comments (gán UserID của author)
CREATE POLICY insert_comments ON Comments
  FOR INSERT
  TO author
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Comments (chỉ sửa của mình)
CREATE POLICY update_comments ON Comments
  FOR UPDATE
  TO author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Comments (chỉ xóa của mình)
CREATE POLICY delete_comments ON Comments
  FOR DELETE
  TO author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Bật RLS trên PostTags
ALTER TABLE PostTags ENABLE ROW LEVEL SECURITY;
ALTER TABLE PostTags FORCE ROW LEVEL SECURITY;

-- Policy cho SELECT trên PostTags (xem tất cả)
CREATE POLICY select_posttags ON PostTags
  FOR SELECT
  TO author
  USING (true);

-- Policy cho INSERT trên PostTags (chỉ cho PostID thuộc author)
-- Policy cho INSERT trên PostTags
CREATE POLICY insert_posttags ON PostTags
FOR INSERT
TO author
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM Posts
        JOIN Users ON Posts.UserID = Users.UserID
        WHERE Posts.PostID = PostTags.PostID
          AND Users.Username = current_user
    )
);

-- Policy cho DELETE trên PostTags
CREATE POLICY delete_posttags ON PostTags
FOR DELETE
TO author
USING (
    EXISTS (
        SELECT 1
        FROM Posts
        JOIN Users ON Posts.UserID = Users.UserID
        WHERE Posts.PostID = PostTags.PostID
          AND Users.Username = current_user
    )
);

-- Policy cho SELECT trên Posts (xem tất cả)
CREATE POLICY select_posts_nguoidung ON Posts
  FOR SELECT
  TO nguoidung
  USING (true);

-- Policy cho SELECT trên Comments (xem tất cả)
CREATE POLICY select_comments_nguoidung ON Comments
  FOR SELECT
  TO nguoidung
  USING (true);

-- Policy cho INSERT trên Comments (gán UserID của nguoidung)
CREATE POLICY insert_comments_nguoidung ON Comments
  FOR INSERT
  TO nguoidung
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Comments (chỉ sửa của mình)
CREATE POLICY update_comments_nguoidung ON Comments
  FOR UPDATE
  TO nguoidung
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Comments (chỉ xóa của mình)
CREATE POLICY delete_comments_nguoidung ON Comments
  FOR DELETE
  TO nguoidung
  USING (UserID = current_setting('my.current_user_id')::int);

-- Đảm bảo admin bỏ qua RLS
GRANT ALL ON Posts, Comments, PostTags TO admin;

-- Quyền SELECT trên các bảng khác không cần RLS vì chỉ có SELECT
-- (Users, Categories, SubCategories, Tags đã được cấp SELECT ở trên)
GRANT CONNECT ON DATABASE newspaper_db TO author, admin, nguoidung;
GRANT USAGE ON SCHEMA public TO author, admin, nguoidung;


-- Step 1: Drop the trigger and its function
DROP TRIGGER IF EXISTS trigger_assign_user_role ON Users;
DROP FUNCTION IF EXISTS assign_user_role;

-- Step 2: Disable and drop RLS policies
-- Disable RLS on Posts
ALTER TABLE Posts DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_posts ON Posts;
DROP POLICY IF EXISTS insert_posts ON Posts;
DROP POLICY IF EXISTS update_posts ON Posts;
DROP POLICY IF EXISTS delete_posts ON Posts;
DROP POLICY IF EXISTS select_posts_nguoidung ON Posts;

-- Disable RLS on Comments
ALTER TABLE Comments DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_comments ON Comments;
DROP POLICY IF EXISTS insert_comments ON Comments;
DROP POLICY IF EXISTS update_comments ON Comments;
DROP POLICY IF EXISTS delete_comments ON Comments;
DROP POLICY IF EXISTS select_comments_nguoidung ON Comments;
DROP POLICY IF EXISTS insert_comments_nguoidung ON Comments;
DROP POLICY IF EXISTS update_comments_nguoidung ON Comments;
DROP POLICY IF EXISTS delete_comments_nguoidung ON Comments;

-- Disable RLS on PostTags
ALTER TABLE PostTags DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_posttags ON PostTags;
DROP POLICY IF EXISTS insert_posttags ON PostTags;
DROP POLICY IF EXISTS delete_posttags ON PostTags;

-- Drop roles
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM author, admin, nguoidung;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM author, admin, nguoidung;
REVOKE ALL ON SCHEMA public FROM author, admin, nguoidung;
REVOKE ALL ON DATABASE newspaper_db FROM author, admin, nguoidung;

DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'author') THEN
      EXECUTE 'REASSIGN OWNED BY author TO postgres';
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin') THEN
      EXECUTE 'REASSIGN OWNED BY admin TO postgres';
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nguoidung') THEN
      EXECUTE 'REASSIGN OWNED BY nguoidung TO postgres';
   END IF;
END $$;

-- Step 7: Drop roles
DROP ROLE IF EXISTS author;
DROP ROLE IF EXISTS admin;
DROP ROLE IF EXISTS nguoidung;
/*---*/

SELECT * FROM pg_roles WHERE rolname = 'admin';

-- Data for testing

-- Reset sequence of serial key
-- Reset sequence cho bảng Users
ALTER SEQUENCE Users_UserID_seq RESTART WITH 1;

-- Reset sequence cho bảng Categories
ALTER SEQUENCE Categories_CategoryID_seq RESTART WITH 1;

-- Reset sequence cho bảng SubCategories
ALTER SEQUENCE SubCategories_SubCategoryID_seq RESTART WITH 1;
delete from posts
-- Reset sequence cho bảng Posts
ALTER SEQUENCE Posts_PostID_seq RESTART WITH 1;

-- Reset sequence cho bảng Comments
ALTER SEQUENCE Comments_CommentID_seq RESTART WITH 1;

-- Reset sequence cho bảng Tags
ALTER SEQUENCE Tags_TagID_seq RESTART WITH 1;
-- Reset sequence cho bảng Media
ALTER SEQUENCE Media_MediaID_seq RESTART WITH 1;
delete from categories;
delete from subcategories;
delete from tags;
delete from comments;
delete from posttags;
delete from users;

select * from users
select * from posts

select * from media;
SELECT 
        p.PostID,
        p.Title,
        LEFT(p.Content, 200) AS Excerpt,
        m.MediaURL AS ImageURL,
        p.slug,
        p.CreatedAtDate,
        u.UserName AS Author,
        c.CategoryName,
        sc.SubCategoryName
      FROM Posts p
      INNER JOIN Users u ON p.UserID = u.UserID
      LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
      LEFT JOIN SubCategories sc ON p.SubCategoryID = sc.SubCategoryID
      LEFT JOIN Media m ON p.PostID = m.PostID
      WHERE p.Featured = true
      ORDER BY p.CreatedAtDate DESC
      LIMIT 5;

select * from tags
select * from users

SELECT 
    p.PostID, 
    p.Title,
    (SELECT m.MediaURL FROM Media m 
     WHERE m.PostID = p.PostID 
     ORDER BY m.CreatedAtDate DESC LIMIT 1) as imageUrl,
    CONCAT('./posts/post', p.PostID, '.html') as link
FROM Posts p
WHERE p.CategoryID = 4 AND p.Featured = true AND p.Status = 'Published'
ORDER BY p.CreatedAtDate DESC
LIMIT 4;


select * from users;
select * from posts order by createatdate DESC;
delete from categories
select * from categories
SELECT
        p.PostID,
        p.UserID,
        p.Title,
        p.Content,
        p.CreatedAtDate,
        p.Status,
        u.UserName as AuthorName,
        (SELECT m.MediaURL FROM Media m
         WHERE m.PostID = p.PostID AND m.MediaType LIKE 'image%'
         ORDER BY m.CreatedAtDate ASC LIMIT 1) as imageUrl,
        CONCAT('./posts/post', p.PostID, '.html') as link
      FROM
        Posts p
      LEFT JOIN
        Users u ON p.UserID = u.UserID
      WHERE
        p.Status = 'Published'
      ORDER BY
        p.CreatedAtDate DESC
      LIMIT 5