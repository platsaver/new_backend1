const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3000; // Cổng server

// Middleware
app.use(cors()); // Cho phép CORS
app.use(express.json()); // Parse JSON body

// Cấu hình kết nối PostgreSQL (thay đổi thông tin nếu cần)
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres', // Thay bằng username của bạn
    password: '1234', // Thay bằng password của bạn
    database: 'newspaper_db' // Thay bằng tên database của bạn
});

// Kiểm tra kết nối database
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Lỗi kết nối database:', err.stack);
    }
    console.log('Kết nối database thành công!');
    release();
});

// Route gốc
app.get('/', (req, res) => {
    res.json({ message: 'Chào mừng đến với The Hanoi Times!' });
});

// Endpoint: Lấy danh sách tất cả bài viết đã xuất bản
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.PostID, p.Title, p.Content, p.Status, p.CreatedAtDate, p.UpdatedAtDate,
                   u.UserName, c.CategoryName, sc.SubCategoryName
            FROM Posts p
            LEFT JOIN Users u ON p.UserID = u.UserID
            LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
            LEFT JOIN SubCategories sc ON p.SubCategoryID = sc.SubCategoryID
            WHERE p.Status = 'Published'
            ORDER BY p.CreatedAtDate DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Lỗi truy vấn:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Endpoint: Lấy chi tiết một bài viết theo ID
app.get('/api/posts/:id', async (req, res) => {
    const postId = parseInt(req.params.id);
    try {
        const result = await pool.query(`
            SELECT p.PostID, p.Title, p.Content, p.Status, p.CreatedAtDate, p.UpdatedAtDate,
                   u.UserName, c.CategoryName, sc.SubCategoryName,
                   ARRAY_AGG(t.TagName) as Tags
            FROM Posts p
            LEFT JOIN Users u ON p.UserID = u.UserID
            LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
            LEFT JOIN SubCategories sc ON p.SubCategoryID = sc.SubCategoryID
            LEFT JOIN PostTags pt ON p.PostID = pt.PostID
            LEFT JOIN Tags t ON pt.TagID = t.TagID
            WHERE p.PostID = $1
            GROUP BY p.PostID, u.UserName, c.CategoryName, sc.SubCategoryName
        `, [postId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bài viết không tồn tại' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Lỗi truy vấn:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Endpoint: Tạo bài viết mới
app.post('/api/posts', async (req, res) => {
  const { userId, title, content, categoryId, subCategoryId, status, tags, media } = req.body;

  // Kiểm tra các trường bắt buộc
  if (!userId || !title || !content) {
    return res.status(400).json({ error: 'Thiếu userId, title hoặc content' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Kiểm tra userId có tồn tại
      const userCheck = await client.query('SELECT 1 FROM Users WHERE UserID = $1', [userId]);
      if (userCheck.rowCount === 0) {
        throw new Error('UserID không tồn tại');
      }

      // Kiểm tra categoryId (nếu có)
      if (categoryId) {
        const categoryCheck = await client.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [categoryId]);
        if (categoryCheck.rowCount === 0) {
          throw new Error('CategoryID không tồn tại');
        }
      }

      // Kiểm tra subCategoryId (nếu có)
      if (subCategoryId) {
        const subCategoryCheck = await client.query(
          'SELECT 1 FROM SubCategories WHERE SubCategoryID = $1 AND ($2::INT IS NULL OR CategoryID = $2)',
          [subCategoryId, categoryId]
        );
        if (subCategoryCheck.rowCount === 0) {
          throw new Error('SubCategoryID không tồn tại hoặc không thuộc CategoryID');
        }
      }

      // Chèn bài viết
      const postResult = await client.query(
        `
        INSERT INTO Posts (UserID, CategoryID, SubCategoryID, Title, Content, Status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING PostID, CreatedAtDate
      `,
        [userId, categoryId || null, subCategoryId || null, title, content, status || 'Draft']
      );

      const postId = postResult.rows[0].postid;
      const createdAtDate = postResult.rows[0].createdatdate;

      // Chèn tags (nếu có)
      if (tags && Array.isArray(tags) && tags.length > 0) {
        for (const tagName of [...new Set(tags)]) {
          const tagResult = await client.query(
            `
            INSERT INTO Tags (TagName)
            VALUES ($1)
            ON CONFLICT (TagName) DO NOTHING
            RETURNING TagID
          `,
            [tagName]
          );

          let tagId;
          if (tagResult.rowCount > 0) {
            tagId = tagResult.rows[0].tagid;
          } else {
            const existingTag = await client.query('SELECT TagID FROM Tags WHERE TagName = $1', [tagName]);
            tagId = existingTag.rows[0].tagid;
          }

          await client.query(
            `
            INSERT INTO PostTags (PostID, TagID)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
            [postId, tagId]
          );
        }
      }

      // Chèn media (nếu có)
      if (media && Array.isArray(media) && media.length > 0) {
        for (const item of media) {
          const { mediaUrl, mediaType } = item;
          if (!mediaUrl || !mediaType) {
            throw new Error('Media phải có mediaUrl và mediaType');
          }
          await client.query(
            `
            INSERT INTO Media (PostID, MediaURL, MediaType)
            VALUES ($1, $2, $3)
          `,
            [postId, mediaUrl, mediaType]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Tạo bài viết thành công',
        postId,
        createdAtDate
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Lỗi giao dịch:', err.message);
      return res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Lỗi tạo bài viết:', err.stack);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Endpoint: Cập nhật bài viết theo ID
app.put('/api/posts/:id', async (req, res) => {
    const postId = parseInt(req.params.id);
    const { title, content, categoryId, subCategoryId, status, tags } = req.body;

    // Kiểm tra các trường bắt buộc
    if (!title || !content) {
        return res.status(400).json({ error: 'Tiêu đề và nội dung là bắt buộc' });
    }

    try {
        // Bắt đầu transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Cập nhật bài viết (không cần set UpdatedAtDate vì trigger sẽ xử lý)
            const updatePostResult = await client.query(`
                UPDATE Posts
                SET Title = $1, Content = $2, CategoryID = $3, SubCategoryID = $4, Status = $5
                WHERE PostID = $6
                RETURNING PostID
            `, [title, content, categoryId || null, subCategoryId || null, status || 'Draft', postId]);

            if (updatePostResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Bài viết không tồn tại' });
            }

            // Xử lý tags (nếu có)
            if (tags && Array.isArray(tags)) {
                // Xóa các tag cũ
                await client.query(`
                    DELETE FROM PostTags
                    WHERE PostID = $1
                `, [postId]);

                // Thêm các tag mới
                for (const tagName of tags) {
                    // Tìm hoặc tạo tag
                    let tagResult = await client.query(`
                        INSERT INTO Tags (TagName)
                        VALUES ($1)
                        ON CONFLICT (TagName) DO UPDATE SET TagName = EXCLUDED.TagName
                        RETURNING TagID
                    `, [tagName]);

                    const tagId = tagResult.rows[0].tagid;

                    // Liên kết tag với bài viết
                    await client.query(`
                        INSERT INTO PostTags (PostID, TagID)
                        VALUES ($1, $2)
                    `, [postId, tagId]);
                }
            }

            await client.query('COMMIT');
            res.json({ message: 'Cập nhật bài viết thành công', postId });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Lỗi cập nhật bài viết:', err.stack);
            res.status(500).json({ error: err.message || 'Lỗi server' });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Lỗi kết nối database:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Endpoint: Xóa bài viết theo ID
app.delete('/api/posts/:id', async (req, res) => {
  const postId = parseInt(req.params.id);

  // Kiểm tra postId hợp lệ
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'postId không hợp lệ' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Xóa bài viết
      const deleteResult = await client.query(
        `
        DELETE FROM Posts
        WHERE PostID = $1
        RETURNING PostID
      `,
        [postId]
      );

      if (deleteResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Bài viết không tồn tại' });
      }

      await client.query('COMMIT');
      res.json({ message: 'Xóa bài viết thành công', postId });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Lỗi xóa bài viết:', err.message);
      res.status(500).json({ error: 'Lỗi server' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Lỗi kết nối database:', err.stack);
    res.status(500).json({ error: 'Lỗi server' });
  }
});


// Endpoint: Lấy danh sách danh mục
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.CategoryID, c.CategoryName,
                   ARRAY_AGG(JSON_BUILD_OBJECT('SubCategoryID', sc.SubCategoryID, 'SubCategoryName', sc.SubCategoryName)) as SubCategories
            FROM Categories c
            LEFT JOIN SubCategories sc ON c.CategoryID = sc.CategoryID
            GROUP BY c.CategoryID, c.CategoryName
            ORDER BY c.CategoryID DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Lỗi truy vấn:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
    }
});
// Endpoint: Lấy danh sách tất cả danh mục phụ
app.get('/api/subcategories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                sc.SubCategoryID,
                sc.SubCategoryName,
                c.CategoryID,
                c.CategoryName
            FROM SubCategories sc
            JOIN Categories c ON sc.CategoryID = c.CategoryID
            ORDER BY sc.SubCategoryID ASC
        `);
        
        if (result.rows.length === 0) {
            return res.status(200).json({ message: 'Không có danh mục phụ nào', subcategories: [] });
        }

        res.json({ subcategories: result.rows });
    } catch (err) {
        console.error('Lỗi truy vấn danh mục phụ:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
    }
});


// 1. Create a User (POST /api/users)
app.post('/api/users', async (req, res) => {
  try {
    const { userName, role, password, email } = req.body;

    // Basic validation
    if (!userName || !password || !email) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields'
      });
    }

    // Query to insert new user
    const query = `
      INSERT INTO Users (UserName, Role, Password, Email)
      VALUES ($1, $2, $3, $4)
      RETURNING UserID, UserName, Role, Email, CreatedAtDate
    `;
    const values = [userName, role || 'NguoiDung', password, email];

    const result = await pool.query(query, values);

    // Format response
    const user = {
      userId: result.rows[0].userid,
      userName: result.rows[0].username,
      role: result.rows[0].role,
      email: result.rows[0].email,
      createdAtDate: result.rows[0].createdatdate
    };

    res.status(201).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        status: 'error',
        message: 'Email already exists'
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 2. Read All Users (GET /api/users)
app.get('/api/users', async (req, res) => {
  try {
    // Query to fetch UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate
    const query = `
      SELECT UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate
      FROM Users
      ORDER BY UserID ASC
    `;

    const result = await pool.query(query);

    // Format response
    const users = result.rows.map((user) => ({
      userId: user.userid,
      userName: user.username,
      role: user.role,
      email: user.email,
      createdAtDate: user.createdatdate,
      updatedAtDate: user.updatedatdate
    }));

    res.status(200).json({
      status: 'success',
      data: {
        users,
        total: users.length
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 3. Read Single User (GET /api/users/:id)
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Query to fetch a single user
    const query = `
      SELECT UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate
      FROM Users
      WHERE UserID = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Format response
    const user = {
      userId: result.rows[0].userid,
      userName: result.rows[0].username,
      role: result.rows[0].role,
      email: result.rows[0].email,
      createdAtDate: result.rows[0].createdatdate,
      updatedAtDate: result.rows[0].updatedatdate
    };

    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 4. Update a User (PUT /api/users/:id)
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userName, role, password, email } = req.body;

    // Check if at least one field is provided
    if (!userName && !role && !password && !email) {
      return res.status(400).json({
        status: 'error',
        message: 'No fields provided for update'
      });
    }

    // Build dynamic query
    const updates = [];
    const values = [];
    let index = 1;

    if (userName) {
      updates.push(`UserName = $${index++}`);
      values.push(userName);
    }
    if (role) {
      updates.push(`Role = $${index++}`);
      values.push(role);
    }
    if (password) {
      updates.push(`Password = $${index++}`);
      values.push(password); // Plain password
    }
    if (email) {
      updates.push(`Email = $${index++}`);
      values.push(email);
    }

    // Always update UpdatedAtDate
    updates.push(`UpdatedAtDate = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE Users
      SET ${updates.join(', ')}
      WHERE UserID = $${index}
      RETURNING UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Format response
    const user = {
      userId: result.rows[0].userid,
      userName: result.rows[0].username,
      role: result.rows[0].role,
      email: result.rows[0].email,
      createdAtDate: result.rows[0].createdatdate,
      updatedAtDate: result.rows[0].updatedatdate
    };

    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        status: 'error',
        message: 'Email already exists'
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 5. Delete a User (DELETE /api/users/:id)
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Query to delete user
    const query = `
      DELETE FROM Users
      WHERE UserID = $1
      RETURNING UserID
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        message: 'User deleted successfully'
      }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// API Create Tag
app.post('/api/tags', async (req, res) => {
    const { TagName } = req.body;
  
    if (!TagName) {
      return res.status(400).json({ error: 'TagName là bắt buộc' });
    }
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          INSERT INTO Tags (TagName)
          VALUES ($1)
          RETURNING TagID, TagName
        `, [TagName]);
  
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi tạo tag:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Read All Tags
  app.get('/api/tags', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT TagID, TagName
        FROM Tags
        ORDER BY TagID DESC
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('Lỗi truy vấn:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Update Tag
  app.put('/api/tags/:id', async (req, res) => {
    const tagId = parseInt(req.params.id);
    const { TagName } = req.body;
  
    if (!TagName) {
      return res.status(400).json({ error: 'TagName là bắt buộc' });
    }
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          UPDATE Tags
          SET TagName = $1
          WHERE TagID = $2
          RETURNING TagID, TagName
        `, [TagName, tagId]);
  
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Tag không tồn tại' });
        }
  
        await client.query('COMMIT');
        res.json(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi cập nhật tag:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Delete Tag
  app.delete('/api/tags/:id', async (req, res) => {
    const tagId = parseInt(req.params.id);
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          DELETE FROM Tags
          WHERE TagID = $1
          RETURNING TagID
        `, [tagId]);
  
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Tag không tồn tại' });
        }
  
        await client.query('COMMIT');
        res.json({ message: 'Xóa tag thành công', tagId });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi xóa tag:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });

// API Create Comment
app.post('/api/comments', async (req, res) => {
    const { PostID, UserID, Content } = req.body;
  
    if (!PostID || !UserID || !Content) {
      return res.status(400).json({ error: 'PostID, UserID và Content là bắt buộc' });
    }
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          INSERT INTO Comments (PostID, UserID, Content)
          VALUES ($1, $2, $3)
          RETURNING CommentID, PostID, UserID, Content, CreatedAtDate, UpdatedAtDate
        `, [PostID, UserID, Content]);
  
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi tạo comment:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Read All Comments (cho một PostID)
  app.get('/api/comments/post/:postId', async (req, res) => {
    const postId = parseInt(req.params.postId);
  
    try {
      const result = await pool.query(`
        SELECT 
          c.CommentID, 
          c.PostID, 
          c.UserID, 
          c.Content, 
          c.CreatedAtDate, 
          c.UpdatedAtDate,
          u.UserName
        FROM Comments c
        LEFT JOIN Users u ON c.UserID = u.UserID
        WHERE c.PostID = $1
        ORDER BY c.CreatedAtDate DESC
      `, [postId]);
  
      res.json(result.rows);
    } catch (err) {
      console.error('Lỗi truy vấn:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Update Comment
  app.put('/api/comments/:id', async (req, res) => {
    const commentId = parseInt(req.params.id);
    const { Content } = req.body;
  
    if (!Content) {
      return res.status(400).json({ error: 'Content là bắt buộc' });
    }
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          UPDATE Comments
          SET Content = $1, UpdatedAtDate = CURRENT_TIMESTAMP
          WHERE CommentID = $2
          RETURNING CommentID, PostID, UserID, Content, CreatedAtDate, UpdatedAtDate
        `, [Content, commentId]);
  
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Comment không tồn tại' });
        }
  
        await client.query('COMMIT');
        res.json(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi cập nhật comment:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });
  
  // API Delete Comment
  app.delete('/api/comments/:id', async (req, res) => {
    const commentId = parseInt(req.params.id);
  
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
  
        const result = await client.query(`
          DELETE FROM Comments
          WHERE CommentID = $1
          RETURNING CommentID
        `, [commentId]);
  
        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Comment không tồn tại' });
        }
  
        await client.query('COMMIT');
        res.json({ message: 'Xóa comment thành công', commentId });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi xóa comment:', err.stack);
        res.status(500).json({ error: 'Lỗi server' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Lỗi kết nối database:', err.stack);
      res.status(500).json({ error: 'Lỗi server' });
    }
  });

  /*Filter*/
  // API liệt kê các bài viết theo category
  app.get('/api/posts/category/:categoryId', async (req, res) => {
    try {
      const { categoryId } = req.params;
  
      // Kiểm tra categoryId
      const parsedCategoryId = parseInt(categoryId, 10);
      if (isNaN(parsedCategoryId)) {
        return res.status(400).json({ error: 'Invalid categoryId: Must be a valid integer' });
      }
  
      const query = `
        SELECT 
          p.PostID, p.Title, p.Content, p.CreatedAtDate,
          c.CategoryName, u.UserName
        FROM Posts p
        LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
        LEFT JOIN Users u ON p.UserID = u.UserID
        WHERE p.CategoryID = $1
      `;
      const result = await pool.query(query, [parsedCategoryId]);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'No posts found for this category' });
      }
  
      res.json(result.rows);
    } catch (error) {
      console.error('Error details:', error.stack);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });


  app.get('/api/posts/search', async (req, res) => {
  try {
    const { keyword, page = 1, limit = 10 } = req.query;
    console.log('Request query:', { keyword, page, limit }); // Log đầu vào

    // Kiểm tra page và limit
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedPage) || parsedPage < 1) {
      return res.status(400).json({ error: 'Invalid page: Must be a positive integer' });
    }
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({ error: 'Invalid limit: Must be a positive integer' });
    }

    const offset = (parsedPage - 1) * parsedLimit;

    // Truy vấn tìm kiếm
    let query = `
      SELECT 
        p.PostID, p.Title, p.Content, p.CreatedAtDate,
        c.CategoryName, u.UserName
      FROM Posts p
      LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
      LEFT JOIN Users u ON p.UserID = u.UserID
    `;
    let countQuery = `
      SELECT COUNT(*) as total
      FROM Posts p
      LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
      LEFT JOIN Users u ON p.UserID = u.UserID
    `;
    let params = [];
    let conditions = [];

    // Xử lý keyword
    if (keyword && keyword.trim()) {
      const searchTerm = `%${keyword.trim()}%`;
      conditions.push(`
        (p.Title ILIKE $${params.length + 1}
        OR p.Content ILIKE $${params.length + 1}
        OR c.CategoryName ILIKE $${params.length + 1})
      `);
      params.push(searchTerm);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Thêm phân trang
    query += `
      ORDER BY p.CreatedAtDate DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(parsedLimit, offset);

    console.log('Executing query:', query);
    console.log('Parameters:', params);

    // Thực thi truy vấn
    const searchResult = await pool.query(query, params);
    const countResult = await pool.query(countQuery, params.slice(0, conditions.length));

    const totalPosts = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalPosts / parsedLimit);

    res.json({
      posts: searchResult.rows,
      pagination: {
        currentPage: parsedPage,
        totalPages,
        totalPosts,
        limit: parsedLimit,
      },
    });
  } catch (error) {
    console.error('Error details:', error.stack);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    });
  }
});

// 1. Create a Media (POST /api/media)
app.post('/api/media', async (req, res) => {
  try {
    const { postId, mediaUrl, mediaType } = req.body;

    // Basic validation
    if (!postId || !mediaUrl || !mediaType) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields'
      });
    }

    // Query to insert new media
    const query = `
      INSERT INTO Media (PostID, MediaURL, MediaType)
      VALUES ($1, $2, $3)
      RETURNING MediaID, PostID, MediaURL, MediaType, CreatedAtDate
    `;
    const values = [postId, mediaUrl, mediaType];

    const result = await pool.query(query, values);

    // Format response
    const media = {
      mediaId: result.rows[0].mediaid,
      postId: result.rows[0].postid,
      mediaUrl: result.rows[0].mediaurl,
      mediaType: result.rows[0].mediatype,
      createdAtDate: result.rows[0].createdatdate
    };

    res.status(201).json({
      status: 'success',
      data: {
        media
      }
    });
  } catch (error) {
    console.error('Error creating media:', error);
    if (error.code === '23503') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid PostID: Post does not exist'
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 2. Read All Media (GET /api/media)
app.get('/api/media', async (req, res) => {
  try {
    // Query to fetch all media
    const query = `
      SELECT MediaID, PostID, MediaURL, MediaType, CreatedAtDate
      FROM Media
      ORDER BY MediaID ASC
    `;

    const result = await pool.query(query);

    // Format response
    const media = result.rows.map((item) => ({
      mediaId: item.mediaid,
      postId: item.postid,
      mediaUrl: item.mediaurl,
      mediaType: item.mediatype,
      createdAtDate: item.createdatdate
    }));

    res.status(200).json({
      status: 'success',
      data: {
        media,
        total: media.length
      }
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 3. Read Single Media (GET /api/media/:id)
app.get('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Query to fetch a single media
    const query = `
      SELECT MediaID, PostID, MediaURL, MediaType, CreatedAtDate
      FROM Media
      WHERE MediaID = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Media not found'
      });
    }

    // Format response
    const media = {
      mediaId: result.rows[0].mediaid,
      postId: result.rows[0].postid,
      mediaUrl: result.rows[0].mediaurl,
      mediaType: result.rows[0].mediatype,
      createdAtDate: result.rows[0].createdatdate
    };

    res.status(200).json({
      status: 'success',
      data: {
        media
      }
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 4. Update a Media (PUT /api/media/:id)
app.put('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { postId, mediaUrl, mediaType } = req.body;

    // Check if at least one field is provided
    if (!postId && !mediaUrl && !mediaType) {
      return res.status(400).json({
        status: 'error',
        message: 'No fields provided for update'
      });
    }

    // Build dynamic query
    const updates = [];
    const values = [];
    let index = 1;

    if (postId) {
      updates.push(`PostID = $${index++}`);
      values.push(postId);
    }
    if (mediaUrl) {
      updates.push(`MediaURL = $${index++}`);
      values.push(mediaUrl);
    }
    if (mediaType) {
      updates.push(`MediaType = $${index++}`);
      values.push(mediaType);
    }

    values.push(id);

    const query = `
      UPDATE Media
      SET ${updates.join(', ')}
      WHERE MediaID = $${index}
      RETURNING MediaID, PostID, MediaURL, MediaType, CreatedAtDate
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Media not found'
      });
    }

    // Format response
    const media = {
      mediaId: result.rows[0].mediaid,
      postId: result.rows[0].postid,
      mediaUrl: result.rows[0].mediaurl,
      mediaType: result.rows[0].mediatype,
      createdAtDate: result.rows[0].createdatdate
    };

    res.status(200).json({
      status: 'success',
      data: {
        media
      }
    });
  } catch (error) {
    console.error('Error updating media:', error);
    if (error.code === '23503') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid PostID: Post does not exist'
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 5. Delete a Media (DELETE /api/media/:id)
app.delete('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Query to delete media
    const query = `
      DELETE FROM Media
      WHERE MediaID = $1
      RETURNING MediaID
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Media not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        message: 'Media deleted successfully'
      }
    });
  } catch (error) {
    console.error('Error deleting media:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const postsCount = await pool.query(`SELECT COUNT(*) FROM Posts`);
    const usersCount = await pool.query(`SELECT COUNT(*) FROM Users`);
    const commentsCount = await pool.query(`SELECT COUNT(*) FROM Comments`);
    res.json({
      totalPosts: postsCount.rows[0].count,
      totalUsers: usersCount.rows[0].count,
      totalComments: commentsCount.rows[0].count
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/api/posts/recent', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM Posts ORDER BY CreatedAtDate DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Lỗi:', err); // Thêm log để kiểm tra lỗi
    res.status(500).json({ error: 'Lỗi server' });
  }
});


// Xử lý lỗi 404
app.use((req, res) => {
    res.status(404).json({ error: 'Không tìm thấy endpoint' });
});

// Xử lý lỗi server
app.use((err, req, res, next) => {
    console.error('Lỗi server:', err.stack);
    res.status(500).json({ error: 'Đã xảy ra lỗi server' });
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});