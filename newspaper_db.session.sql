CREATE TABLE Users (
    UserID SERIAL PRIMARY KEY,
    UserName VARCHAR(255) NOT NULL,
    Role VARCHAR(50) NOT NULL,
    Password VARCHAR(255) NOT NULL,
    Email VARCHAR(255) UNIQUE NOT NULL,
    CreatedAtDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAtDate TIMESTAMP DEFAULT NULL
);
select * from users
ALTER TABLE Users
ALTER COLUMN Role SET DEFAULT 'NguoiDung';
select * from users
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
    FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID) ON DELETE SET NULL,
    FOREIGN KEY (SubCategoryID) REFERENCES SubCategories(SubCategoryID) ON DELETE SET NULL
);
ALTER TABLE Posts
ADD Featured BOOLEAN DEFAULT FALSE;
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
  IF NEW.Role = 'Author' THEN
    EXECUTE format('GRANT Author TO %I', NEW.UserName);
  ELSIF NEW.Role = 'Admin' THEN
    EXECUTE format('GRANT Admin TO %I', NEW.UserName);
  ELSIF NEW.Role = 'NguoiDung' THEN
    EXECUTE format('GRANT NguoiDung TO %I', NEW.UserName);
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

ALTER TABLE Users ADD COLUMN PlainPassword VARCHAR(255);
select * from users
DROP OWNED BY testuser1;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM testuser1;
REVOKE ALL ON SCHEMA public FROM testuser1;
DROP USER testuser1;
-- Hàm trigger để thu hồi quyền khi xóa tài khoản
CREATE OR REPLACE FUNCTION revoke_and_drop_user_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- First revoke the role based on the user's role
  IF OLD.Role = 'Author' THEN
    EXECUTE format('REVOKE Author FROM %I', OLD.UserName);
  ELSIF OLD.Role = 'Admin' THEN
    EXECUTE format('REVOKE Admin FROM %I', OLD.UserName);
  ELSIF OLD.Role = 'NguoiDung' THEN
    EXECUTE format('REVOKE NguoiDung FROM %I', OLD.UserName);
  ELSE
    RAISE NOTICE 'Role % không hợp lệ, không thu hồi quyền', OLD.Role;
  END IF;
  
  -- Then drop the user/login from PostgreSQL
  BEGIN
    EXECUTE format('DROP USER IF EXISTS %I', OLD.UserName);
    RAISE NOTICE 'Đã xóa user/login % khỏi hệ thống', OLD.UserName;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Lỗi khi xóa user/login %: %', OLD.UserName, SQLERRM;
  END;
  
  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Lỗi khi xử lý xóa tài khoản %: %', OLD.UserName, SQLERRM;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function when a user is deleted
CREATE TRIGGER trigger_revoke_and_drop_user_on_delete
AFTER DELETE ON Users
FOR EACH ROW
EXECUTE FUNCTION revoke_and_drop_user_on_delete();

-- Hàm trigger để phân lại quyền mỗi khi thay đổi thuộc tính role
-- Function to handle role changes
CREATE OR REPLACE FUNCTION update_user_role()
RETURNS TRIGGER AS $$
BEGIN
    -- Kiểm tra user tồn tại
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = NEW.Username) THEN
        RAISE EXCEPTION 'User % không tồn tại trong PostgreSQL', NEW.Username;
    END IF;

    -- Cập nhật timestamp
    NEW.UpdatedAtDate = CURRENT_TIMESTAMP;

    -- Thu hồi tất cả các role hiện có (cách hiệu quả hơn)
    EXECUTE format('REVOKE Author, Admin, NguoiDung FROM %I', NEW.Username);

    -- Gán role mới
    IF NEW.Role = 'Author' THEN
        EXECUTE format('GRANT Author TO %I', NEW.Username);
    ELSIF NEW.Role = 'Admin' THEN
        EXECUTE format('GRANT Admin TO %I', NEW.Username);
    ELSIF NEW.Role = 'NguoiDung' THEN
        EXECUTE format('GRANT NguoiDung TO %I', NEW.Username);
    ELSE
        RAISE EXCEPTION 'Vai trò không hợp lệ: %', NEW.Role;
    END IF;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Lỗi khi cập nhật role cho user %: %', NEW.Username, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Chỉ tạo trigger MỘT lần
DROP TRIGGER IF EXISTS role_update_trigger ON Users;
CREATE TRIGGER role_update_trigger
BEFORE UPDATE OF Role ON Users
FOR EACH ROW
WHEN (OLD.Role IS DISTINCT FROM NEW.Role)
EXECUTE FUNCTION update_user_role();

UPDATE Users SET Role = 'NguoiDung' WHERE Username = 'testuser1';
select * from users
SELECT rolname FROM pg_roles WHERE rolname = 'testuser1';
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

-- Reset sequence of serial key
-- Reset sequence cho bảng Users
ALTER SEQUENCE Users_UserID_seq RESTART WITH 1;

-- Reset sequence cho bảng Categories
ALTER SEQUENCE Categories_CategoryID_seq RESTART WITH 1;

-- Reset sequence cho bảng SubCategories
ALTER SEQUENCE SubCategories_SubCategoryID_seq RESTART WITH 1;

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
delete from posts;
delete from comments;
delete from posttags;
delete from users;


-- Chèn dữ liệu vào bảng Users
INSERT INTO Users (UserName, Role, Password, Email) VALUES
('john_doe', 'Author', 'hashed_password_123', 'john@example.com'),
('jane_smith', 'Admin', 'hashed_password_456', 'jane@example.com');
insert into users (username, role, password, email) values
('nguyenvanA', 'Author', 'hashed_password_1', 'nguyenvana@example.com'),
('tranthiB', 'Author', 'hashed_password_2', 'tranthib@example.com'), 
('quan', 'NguoiDung', 'quan123', 'quan123@gmail.com');
select * from users

INSERT INTO Categories (CategoryName) VALUES
('Thời Sự'),
('Kinh doanh'),
('Bất động sản'),
('Pháp luật');
select * from categories
INSERT INTO SubCategories (CategoryID, SubCategoryName) VALUES
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Thời Sự'), 'Trong nước'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Thời Sự'), 'Quốc tế'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Kinh doanh'), 'Doanh nghiệp'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Kinh doanh'), 'Chứng khoán'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Kinh doanh'), 'Quốc tế'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Bất động sản'), 'Chính sách'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Bất động sản'), 'Thị trường'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Bất động sản'), 'Dự án'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Pháp luật'), 'Trong nước'),
((SELECT CategoryID FROM Categories WHERE CategoryName = 'Pháp luật'), 'Quốc tế');
select * from subcategories
INSERT INTO Tags (TagName) VALUES
('nóng'),
('kinh tế'),
('bất động sản'),
('pháp luật'),
('quốc tế');
select * from tags

INSERT INTO Posts (UserID, CategoryID, SubCategoryID, Title, Content, Status, Featured) VALUES
((SELECT UserID FROM Users WHERE UserName = 'nguyenvanA'), 
 (SELECT CategoryID FROM Categories WHERE CategoryName = 'Thời Sự'), 
 (SELECT SubCategoryID FROM SubCategories WHERE SubCategoryName = 'Trong nước' AND CategoryID = (SELECT CategoryID FROM Categories WHERE CategoryName = 'Thời Sự')), 
 'Cơn bão số 5 đổ bộ miền Trung', 
 'Nội dung chi tiết về cơn bão số 5 và ảnh hưởng đến các tỉnh miền Trung...', 
 'Published', TRUE),
((SELECT UserID FROM Users WHERE UserName = 'tranthiB'), 
 (SELECT CategoryID FROM Categories WHERE CategoryName = 'Kinh doanh'), 
 (SELECT SubCategoryID FROM SubCategories WHERE SubCategoryName = 'Chứng khoán' AND CategoryID = (SELECT CategoryID FROM Categories WHERE CategoryName = 'Kinh doanh')), 
 'VN-Index vượt mốc 1.300 điểm', 
 'Phân tích thị trường chứng khoán tuần qua và dự báo xu hướng...', 
 'Published', FALSE),
((SELECT UserID FROM Users WHERE UserName = 'nguyenvanA'), 
 (SELECT CategoryID FROM Categories WHERE CategoryName = 'Bất động sản'), 
 (SELECT SubCategoryID FROM SubCategories WHERE SubCategoryName = 'Thị trường' AND CategoryID = (SELECT CategoryID FROM Categories WHERE CategoryName = 'Bất động sản')), 
 'Giá nhà đất Hà Nội tăng đột biến', 
 'Báo cáo về giá bất động sản tại Hà Nội trong quý 3/2025...', 
 'Draft', TRUE),
((SELECT UserID FROM Users WHERE UserName = 'tranthiB'), 
 (SELECT CategoryID FROM Categories WHERE CategoryName = 'Pháp luật'), 
 (SELECT SubCategoryID FROM SubCategories WHERE SubCategoryName = 'Quốc tế' AND CategoryID = (SELECT CategoryID FROM Categories WHERE CategoryName = 'Pháp luật')), 
 'Vụ án quốc tế gây tranh cãi', 
 'Thông tin về vụ án liên quan đến luật pháp quốc tế...', 
 'Published', FALSE);
 select * from posts

 INSERT INTO Comments (PostID, UserID, Content) VALUES
((SELECT PostID FROM Posts WHERE Title = 'Cơn bão số 5 đổ bộ miền Trung'), 
 (SELECT UserID FROM Users WHERE UserName = 'nguyenvanA'), 
 'Hy vọng chính quyền hỗ trợ kịp thời cho người dân!'),
((SELECT PostID FROM Posts WHERE Title = 'VN-Index vượt mốc 1.300 điểm'), 
 (SELECT UserID FROM Users WHERE UserName = 'quan'), 
 'Tuyệt vời, thị trường đang rất sôi động!'),
((SELECT PostID FROM Posts WHERE Title = 'Giá nhà đất Hà Nội tăng đột biến'), 
 (SELECT UserID FROM Users WHERE UserName = 'tranthiB'), 
 'Cần chính sách kiểm soát giá cả.');
 select * from comments

INSERT INTO PostTags (PostID, TagID) VALUES
((SELECT PostID FROM Posts WHERE Title = 'Cơn bão số 5 đổ bộ miền Trung'), 
 (SELECT TagID FROM Tags WHERE TagName = 'nóng')),
((SELECT PostID FROM Posts WHERE Title = 'VN-Index vượt mốc 1.300 điểm'), 
 (SELECT TagID FROM Tags WHERE TagName = 'kinh tế')),
((SELECT PostID FROM Posts WHERE Title = 'VN-Index vượt mốc 1.300 điểm'), 
 (SELECT TagID FROM Tags WHERE TagName = 'quốc tế')),
((SELECT PostID FROM Posts WHERE Title = 'Giá nhà đất Hà Nội tăng đột biến'), 
 (SELECT TagID FROM Tags WHERE TagName = 'bất động sản'));
 select * from posttags

 select * from subcategories
 select * from categories
 select * from users
 select * from posts

SELECT PostID, UserID, CategoryID, SubCategoryID, Title, Content, CreatedAtDate, UpdatedAtDate, Status, Featured 
      FROM Posts
      WHERE Featured = TRUE
      ORDER BY CreatedAtDate DESC
      LIMIT 5;

select * from Categories