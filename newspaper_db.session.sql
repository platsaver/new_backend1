CREATE TABLE Users (
    UserID SERIAL PRIMARY KEY,
    UserName VARCHAR(255) NOT NULL,
    Role VARCHAR(50) NOT NULL,
    Password VARCHAR(255) NOT NULL,
    Email VARCHAR(255) UNIQUE NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAtDate TIMESTAMP DEFAULT NULL
);
ALTER TABLE Users
ALTER COLUMN Role SET DEFAULT 'NguoiDung';

CREATE TABLE Categories (
    CategoryID SERIAL PRIMARY KEY,
    CategoryName VARCHAR(255) NOT NULL,
    UNIQUE (CategoryName)
);
CREATE TABLE SubCategories (
    SubCategoryID SERIAL PRIMARY KEY,
    CategoryID INT NOT NULL,
    SubCategoryName VARCHAR(255) NOT NULL,
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID) ON DELETE CASCADE,
    UNIQUE (CategoryID, SubCategoryName)
);

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
    FOREIGN KEY (PostID) REFERENCES Posts(PostID) ON DELETE CASCADE,
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
);
CREATE TABLE PostTags (
    PostID INT NOT NULL,
    TagID INT NOT NULL,
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
    PostID INT NOT NULL,
    MediaURL TEXT NOT NULL,
    MediaType VARCHAR(50) NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (PostID) REFERENCES Posts(PostID) ON DELETE CASCADE
);
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

-- Trigger tự động phân quyền mỗi khi đăng ký tài khoản mới
CREATE OR REPLACE FUNCTION assign_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Kiểm tra giá trị Role và gán role PostgreSQL tương ứng
  IF NEW.Role = 'Author' THEN
    -- Gán role Author cho user PostgreSQL có tên là NEW.UserName
    EXECUTE format('GRANT Author TO %I', NEW.UserName);
  ELSIF NEW.Role = 'Admin' THEN
    -- Gán role Admin
    EXECUTE format('GRANT Admin TO %I', NEW.UserName);
  ELSIF NEW.Role = 'NguoiDung' THEN
    -- Gán role NguoiDung
    EXECUTE format('GRANT NguoiDung TO %I', NEW.UserName);
  ELSE
    -- Nếu Role không hợp lệ, ghi log hoặc bỏ qua
    RAISE NOTICE 'Role % không hợp lệ, không gán quyền', NEW.Role;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Nếu lỗi (ví dụ: user PostgreSQL không tồn tại), ghi log và tiếp tục
    RAISE NOTICE 'Lỗi khi gán role cho user %: %', NEW.UserName, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bước 3: Tạo trigger
CREATE TRIGGER trigger_assign_user_role
AFTER INSERT ON Users
FOR EACH ROW
EXECUTE FUNCTION assign_user_role();

/*---*/

/*Phân quyền và thu hồi quyền (khi cần)*/
CREATE USER john_doe WITH PASSWORD 'hashed_password_123';
CREATE USER jane_smith WITH PASSWORD 'hashed_password_456';
CREATE ROLE Author;
CREATE ROLE Admin;
CREATE ROLE NguoiDung;
-- Admin
GRANT ALL PRIVILEGES ON DATABASE newspaper_db TO Admin;
-- Author 
GRANT SELECT ON Users, Posts, Comments, Categories, SubCategories, Tags, PostTags TO Author;
GRANT INSERT, UPDATE, DELETE ON Posts TO Author;
GRANT INSERT, UPDATE, DELETE ON Comments TO Author;
GRANT INSERT ON Tags TO Author;
GRANT INSERT, DELETE ON PostTags TO Author;
-- NguoiDung
GRANT SELECT ON Posts TO NguoiDung;
GRANT SELECT, INSERT, UPDATE, DELETE ON Comments TO NguoiDung;
-- Grant sequence to Author and Admin
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO Author;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO Admin;
GRANT USAGE, SELECT ON SEQUENCE Comments_CommentID_seq TO NguoiDung;
-- Bật RLS trên Posts
ALTER TABLE Posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE Posts FORCE ROW LEVEL SECURITY; -- Buộc tất cả user (trừ owner) tuân theo RLS

-- Policy cho SELECT trên Posts (xem tất cả)
CREATE POLICY select_posts ON Posts
  FOR SELECT
  TO Author
  USING (true);

-- Policy cho INSERT trên Posts (gán UserID của Author)
CREATE POLICY insert_posts ON Posts
  FOR INSERT
  TO Author
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Posts (chỉ sửa của mình)
CREATE POLICY update_posts ON Posts
  FOR UPDATE
  TO Author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Posts (chỉ xóa của mình)
CREATE POLICY delete_posts ON Posts
  FOR DELETE
  TO Author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Bật RLS trên Comments
ALTER TABLE Comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE Comments FORCE ROW LEVEL SECURITY;

-- Policy cho SELECT trên Comments (xem tất cả)
CREATE POLICY select_comments ON Comments
  FOR SELECT
  TO Author
  USING (true);

-- Policy cho INSERT trên Comments (gán UserID của Author)
CREATE POLICY insert_comments ON Comments
  FOR INSERT
  TO Author
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Comments (chỉ sửa của mình)
CREATE POLICY update_comments ON Comments
  FOR UPDATE
  TO Author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Comments (chỉ xóa của mình)
CREATE POLICY delete_comments ON Comments
  FOR DELETE
  TO Author
  USING (UserID = current_setting('my.current_user_id')::int);

-- Bật RLS trên PostTags
ALTER TABLE PostTags ENABLE ROW LEVEL SECURITY;
ALTER TABLE PostTags FORCE ROW LEVEL SECURITY;

-- Policy cho SELECT trên PostTags (xem tất cả)
CREATE POLICY select_posttags ON PostTags
  FOR SELECT
  TO Author
  USING (true);

-- Policy cho INSERT trên PostTags (chỉ cho PostID thuộc Author)
-- Policy cho INSERT trên PostTags
CREATE POLICY insert_posttags ON PostTags
FOR INSERT
TO Author
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
TO Author
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
  TO NguoiDung
  USING (true);

-- Policy cho SELECT trên Comments (xem tất cả)
CREATE POLICY select_comments_nguoidung ON Comments
  FOR SELECT
  TO NguoiDung
  USING (true);

-- Policy cho INSERT trên Comments (gán UserID của NguoiDung)
CREATE POLICY insert_comments_nguoidung ON Comments
  FOR INSERT
  TO NguoiDung
  WITH CHECK (UserID = current_setting('my.current_user_id')::int);

-- Policy cho UPDATE trên Comments (chỉ sửa của mình)
CREATE POLICY update_comments_nguoidung ON Comments
  FOR UPDATE
  TO NguoiDung
  USING (UserID = current_setting('my.current_user_id')::int);

-- Policy cho DELETE trên Comments (chỉ xóa của mình)
CREATE POLICY delete_comments_nguoidung ON Comments
  FOR DELETE
  TO NguoiDung
  USING (UserID = current_setting('my.current_user_id')::int);

-- Đảm bảo Admin bỏ qua RLS
GRANT ALL ON Posts, Comments, PostTags TO Admin;

-- Quyền SELECT trên các bảng khác không cần RLS vì chỉ có SELECT
-- (Users, Categories, SubCategories, Tags đã được cấp SELECT ở trên)
GRANT Author TO john_doe;
GRANT Admin TO jane_smith;
GRANT CONNECT ON DATABASE newspaper_db TO Author, Admin, NguoiDung;
GRANT USAGE ON SCHEMA public TO Author, Admin, NguoiDung;


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
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM Author, Admin, NguoiDung;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM Author, Admin, NguoiDung;
REVOKE ALL ON SCHEMA public FROM Author, Admin, NguoiDung;
REVOKE ALL ON DATABASE newspaper_db FROM Author, Admin, NguoiDung;

DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'author') THEN
      EXECUTE 'REASSIGN OWNED BY Author TO postgres';
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin') THEN
      EXECUTE 'REASSIGN OWNED BY Admin TO postgres';
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nguoidung') THEN
      EXECUTE 'REASSIGN OWNED BY NguoiDung TO postgres';
   END IF;
END $$;

-- Step 7: Drop roles
DROP ROLE IF EXISTS Author;
DROP ROLE IF EXISTS Admin;
DROP ROLE IF EXISTS NguoiDung;

-- Step 8: Drop users
DROP USER IF EXISTS john_doe;
DROP USER IF EXISTS jane_smith;
DROP USER IF EXISTS quan;
select * from users
SELECT * FROM information_schema.triggers WHERE trigger_name = 'trigger_assign_user_role';
SELECT * FROM information_schema.routines WHERE routine_name = 'assign_user_role';
SELECT rolname FROM pg_roles WHERE rolname IN ('author', 'admin', 'nguoidung');
SELECT usename FROM pg_user WHERE usename IN ('john_doe', 'jane_smith');
/*---*/

SELECT * FROM pg_roles WHERE rolname = 'admin';

-- Data for testing
-- Chèn dữ liệu vào bảng Users
INSERT INTO Users (UserName, Role, Password, Email) VALUES
('john_doe', 'Author', 'hashed_password_123', 'john@example.com'),
('jane_smith', 'Admin', 'hashed_password_456', 'jane@example.com');
select * from users
-- Chèn dữ liệu vào bảng Categories
INSERT INTO Categories (CategoryName) VALUES
('ThoiSu'),
('KinhDoanh'), 
('BatDongSan'), 
('PhapLuat');


-- Chèn dữ liệu vào bảng SubCategories
INSERT INTO SubCategories (CategoryID, SubCategoryName) VALUES
(1, 'TrongNuoc'),
(1, 'QuocTe'),
(2, 'QuocTe'),
(2, 'ChungKhoan'),
(2, 'DoanhNghiep'),
(3, 'ChinhSach'),
(3, 'ThiTruong'),
(3, 'DuAn'),
(4, 'TrongNuoc'),
(4, 'QuocTe');

-- Chèn dữ liệu vào bảng Tags
INSERT INTO Tags (TagName) VALUES
('batdongsan'),
('phapluat'),
('thoisu'),
('kinhdoanh');