const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { fileTypeFromFile } = require('file-type');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const marked = require('marked');
const matter = require('gray-matter');

const app = express();
const port = 3000; // Cổng server
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

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
// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
      user: 'kingdomofhellborn123@gmail.com',
      pass: 'ehporfkkzfyxivao', // Use app-specific password for Gmail
  },
});
// Temporary OTP storage (in-memory, replace with Redis in production)
const otpStorage = {};

// Generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
// Cấu hình Multer để upload ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uniqueSuffix}${ext}`);
  }
});
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
  } else {
      cb(new Error('Only JPEG, PNG, and GIF images are allowed'), false);
  }
};
const upload = multer({
  storage,
  fileFilter
});
// Middleware xử lý lỗi Multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
  } else if (err) {
      return res.status(400).json({ error: err.message });
  }
  next();
};

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




// 1) Các API liên quan đến bảng Posts
//Tạo bài viết mới
app.post('/posts', async (req, res) => {
  const { userid, categoryid, subcategoryid, title, content, status, featured } = req.body;

  // Validation cơ bản
  if (!userid || !title || !content) {
    return res.status(400).json({ error: 'UserID, Title, and Content are required' });
  }

  // Kiểm tra tồn tại của UserID
  const userCheck = await pool.query('SELECT 1 FROM Users WHERE UserID = $1', [userid]);
  if (userCheck.rowCount === 0) {
    return res.status(400).json({ error: 'Invalid UserID: User does not exist' });
  }

  // Kiểm tra CategoryID (nếu có)
  if (categoryid) {
    const categoryCheck = await pool.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [categoryid]);
    if (categoryCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid CategoryID: Category does not exist' });
    }
  }

  // Kiểm tra SubCategoryID (nếu có)
  if (subcategoryid) {
    const subCategoryCheck = await pool.query('SELECT 1 FROM SubCategories WHERE SubCategoryID = $1', [subcategoryid]);
    if (subCategoryCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid SubCategoryID: SubCategory does not exist' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO Posts (UserID, CategoryID, SubCategoryID, Title, Content, Status, Featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userid, categoryid || null, subcategoryid || null, title, content, status || 'Draft', featured || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating post:', error);
    if (error.code === '23503') { // Lỗi khóa ngoại
      return res.status(400).json({ error: 'Foreign key constraint violation' });
    } else if (error.code === '23502') { // Lỗi NOT NULL
      return res.status(400).json({ error: 'Required field is missing' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
//Liệt kê tất cả các bài viết hiện tại có trong hệ thống 
app.get('/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Posts ORDER BY CreatedAtDate DESC');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Liệt kê tất cả các bài viết hiện tại có trong hệ thống theo status='Published'
app.get('/posts/published', async (req, res) => {
  try {
    // Chỉ lấy các bài viết có status là 'Published' và sắp xếp theo ngày tạo mới nhất
    const result = await pool.query(
      'SELECT * FROM Posts WHERE Status = $1 ORDER BY CreatedAtDate DESC', 
      ['Published']
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching published posts:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});
//Đọc chi tiết của một bài viết theo id của nó
app.get('/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM Posts WHERE PostID = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
//Cập nhật bài viết
app.put('/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { userid, categoryid, subcategoryid, title, content, status, featured } = req.body;

  // Validation cơ bản
  if (!userid || !title || !content) {
    return res.status(400).json({ error: 'UserID, Title, and Content are required' });
  }

  // Kiểm tra tồn tại của UserID
  const userCheck = await pool.query('SELECT 1 FROM Users WHERE UserID = $1', [userid]);
  if (userCheck.rowCount === 0) {
    return res.status(400).json({ error: 'Invalid UserID: User does not exist' });
  }

  // Kiểm tra CategoryID (nếu có)
  if (categoryid) {
    const categoryCheck = await pool.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [categoryid]);
    if (categoryCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid CategoryID: Category does not exist' });
    }
  }

  // Kiểm tra SubCategoryID (nếu có)
  if (subcategoryid) {
    const subCategoryCheck = await pool.query('SELECT 1 FROM SubCategories WHERE SubCategoryID = $1', [subcategoryid]);
    if (subCategoryCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid SubCategoryID: SubCategory does not exist' });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE Posts
       SET UserID = $1, CategoryID = $2, SubCategoryID = $3, Title = $4, Content = $5, Status = $6, Featured = $7, UpdatedAtDate = CURRENT_TIMESTAMP
       WHERE PostID = $8
       RETURNING *`,
      [userid, categoryid || null, subcategoryid || null, title, content, status || 'Draft', featured ?? null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating post:', error);
    if (error.code === '23503') { // Lỗi khóa ngoại
      return res.status(400).json({ error: 'Foreign key constraint violation' });
    } else if (error.code === '23502') { // Lỗi NOT NULL
      return res.status(400).json({ error: 'Required field is missing' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
//Xóa bài viết
app.delete('/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM Posts WHERE PostID = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(200).json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Lấy 5 bài viết nổi bật nhất được tạo gần đây
app.get('/api/featured-posts', async (req, res) => {
  try {
    const query = `
      SELECT PostID, UserID, CategoryID, SubCategoryID, Title, Content, 
             CreatedAtDate, UpdatedAtDate, Status, Featured
      FROM Posts
      WHERE Featured = true
      ORDER BY CreatedAtDate DESC
      LIMIT 5;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching featured posts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// lấy 5 bài viết nổi bật nhất của một category 
app.get('/api/featured-posts/category/:categoryId', async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    
    const query = `
      SELECT PostID, UserID, CategoryID, SubCategoryID, Title, Content, 
             CreatedAtDate, UpdatedAtDate, Status, Featured
      FROM Posts
      WHERE CategoryID = $1 AND Featured = true
      ORDER BY CreatedAtDate DESC
      LIMIT 4;
    `;
    
    const result = await pool.query(query, [categoryId]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching featured posts by category:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Lấy 5 bài viết được tạo gần đây nhất theo một subcategory
app.get('/api/posts/subcategory/:subcategoryId/recent', async (req, res) => {
  try {
    const subcategoryId = req.params.subcategoryId;
    
    const query = `
      SELECT PostID, UserID, CategoryID, SubCategoryID, Title, Content, 
             CreatedAtDate, UpdatedAtDate, Status, Featured
      FROM Posts
      WHERE SubCategoryID = $1
      ORDER BY CreatedAtDate DESC
      LIMIT 5;
    `;
    
    const result = await pool.query(query, [subcategoryId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No posts found in this subcategory' });
    }
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching recent posts by subcategory:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Tìm kiếm bài viết cần thiết
app.get('/api/posts/search', async (req, res) => {
  try {
    const cleanedQuery = {};
    for (const [key, value] of Object.entries(req.query)) {
      cleanedQuery[key.trim()] = typeof value === 'string' ? value.trim() : value;
    }
    // Lấy các tham số tìm kiếm từ query string
    const {
      keyword,
      categoryId,
      subcategoryId,
      status,
      featured,
      userId,
      limit = 10,
      offset = 0,
    } = cleanedQuery;

    console.log('Received query parameters:', req.query);

    // Validate and normalize inputs
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({ error: 'Invalid limit value' });
    }
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Invalid offset value' });
    }

    // Normalize keyword (trim and ensure it’s a string)
    const normalizedKeyword = keyword ? String(keyword).trim() : null;

    // Xây dựng câu truy vấn SQL động
    let queryText = `
      SELECT PostID, UserID, CategoryID, SubCategoryID, Title, Content, 
             CreatedAtDate, UpdatedAtDate, Status, Featured
      FROM Posts
      WHERE 1=1
    `;
    
    // Mảng chứa các tham số cho truy vấn
    const queryParams = [];
    let paramIndex = 1;

    // Thêm điều kiện tìm kiếm theo từ khóa
    if (normalizedKeyword) {
      queryText += ` AND (LOWER(Title) LIKE LOWER($${paramIndex}) OR LOWER(Content) LIKE LOWER($${paramIndex}))`;
      queryParams.push(`%${normalizedKeyword}%`);
      paramIndex++;
    }

    // Thêm điều kiện tìm kiếm theo categoryId
    if (categoryId) {
      queryText += ` AND CategoryID = $${paramIndex}`;
      queryParams.push(categoryId);
      paramIndex++;
    }

    // Thêm điều kiện tìm kiếm theo subcategoryId
    if (subcategoryId) {
      queryText += ` AND SubCategoryID = $${paramIndex}`;
      queryParams.push(subcategoryId);
      paramIndex++;
    }

    // Thêm điều kiện tìm kiếm theo status
    if (status) {
      queryText += ` AND Status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Thêm điều kiện tìm kiếm theo featured
    if (featured !== undefined) {
      queryText += ` AND Featured = $${paramIndex}`;
      queryParams.push(featured === 'true');
      paramIndex++;
    }

    // Thêm điều kiện tìm kiếm theo userId
    if (userId) {
      queryText += ` AND UserID = $${paramIndex}`;
      queryParams.push(userId);
      paramIndex++;
    }

    // Sắp xếp kết quả theo thời gian tạo bài viết mới nhất
    queryText += ` ORDER BY CreatedAtDate DESC`;

    // Thêm giới hạn và vị trí bắt đầu cho phân trang
    queryText += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(parsedLimit, parsedOffset);

    console.log('Query:', queryText);
    console.log('Params:', queryParams);

    // Thực hiện truy vấn
    const result = await pool.query(queryText, queryParams);

    // Đếm tổng số bài viết phù hợp với điều kiện tìm kiếm
    let countQueryText = `
      SELECT COUNT(*) as total
      FROM Posts
      WHERE 1=1
    `;
    
    const countQueryParams = [...queryParams.slice(0, queryParams.length - 2)];
    let countParamIndex = 1;
    
    if (normalizedKeyword) {
      countQueryText += ` AND (LOWER(Title) LIKE LOWER($${countParamIndex}) OR LOWER(Content) LIKE LOWER($${countParamIndex}))`;
      countParamIndex++;
    }

    if (categoryId) {
      countQueryText += ` AND CategoryID = $${countParamIndex}`;
      countParamIndex++;
    }

    if (subcategoryId) {
      countQueryText += ` AND SubCategoryID = $${countParamIndex}`;
      countParamIndex++;
    }

    if (status) {
      countQueryText += ` AND Status = $${countParamIndex}`;
      countParamIndex++;
    }

    if (featured !== undefined) {
      countQueryText += ` AND Featured = $${countParamIndex}`;
      countParamIndex++;
    }

    if (userId) {
      countQueryText += ` AND UserID = $${countParamIndex}`;
      countParamIndex++;
    }
    
    console.log('Count Query:', countQueryText);
    console.log('Count Params:', countQueryParams);
    
    // Thực hiện truy vấn đếm
    const countResult = await pool.query(countQueryText, countQueryParams);
    const totalPosts = parseInt(countResult.rows[0].total);

    // Trả về kết quả tìm kiếm và thông tin phân trang
    res.status(200).json({
      posts: result.rows,
      pagination: {
        total: totalPosts,
        limit: parsedLimit,
        offset: parsedOffset,
        pages: Math.ceil(totalPosts / parsedLimit),
      },
    });
  } catch (error) {
    console.error('Error searching posts:', error.stack);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error.message,
    });
  }
});
/**
 * API để tìm các bài viết thuộc các tác giả nhất định
 * GET /api/posts/authors?userIds=1,2,3&page=1&limit=10
 */
app.get('/api/posts/authors', async (req, res) => {
  try {
    const { userIds, page = 1, limit = 10 } = req.query;
    
    // Kiểm tra userIds
    if (!userIds) {
      return res.status(400).json({ error: 'userIds is required' });
    }
    
    // Chuyển userIds thành mảng và kiểm tra hợp lệ
    const userIdArray = userIds.split(',')
      .map(id => {
        const parsedId = parseInt(id.trim());
        return parsedId;
      })
      .filter(id => !isNaN(id));
      
    if (userIdArray.length === 0) {
      return res.status(400).json({ error: 'Invalid userIds' });
    }
    
    // Tính toán phân trang
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    const offset = (parsedPage - 1) * parsedLimit;
    
    const queryText = `
      SELECT p.*, u.Username 
      FROM Posts p
      JOIN Users u ON p.UserID = u.UserID
      WHERE p.UserID = ANY($1::int[])
      ORDER BY p.CreatedAtDate DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) 
      FROM Posts
      WHERE UserID = ANY($1::int[])
    `;
    
    // Thực hiện truy vấn
    const [postsResult, countResult] = await Promise.all([
      pool.query(queryText, [userIdArray, parsedLimit, offset]),
      pool.query(countQuery, [userIdArray]),
    ]);
    
    const totalPosts = parseInt(countResult.rows[0].count);
    
    if (postsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No posts found' });
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        posts: postsResult.rows,
        pagination: {
          currentPage: parsedPage,
          totalPages: Math.ceil(totalPosts / parsedLimit),
          totalPosts,
          limit: parsedLimit,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching posts by authors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * API để tìm các bài viết thuộc trạng thái bất kỳ
 * GET /api/posts/status?statuses=Draft,Published,Archieve&page=1&limit=10
 */
app.get('/api/posts/status', async (req, res) => {
  try {
    const { statuses, page = 1, limit = 10 } = req.query;
    
    // Kiểm tra statuses
    if (!statuses) {
      return res.status(400).json({ error: 'statuses is required' });
    }
    
    // Chuyển statuses thành mảng và kiểm tra hợp lệ
    const validStatuses = ['Draft', 'Published', 'Archieve'];
    const statusArray = statuses.split(',')
      .map(s => s.trim())
      .filter(s => validStatuses.includes(s));
      
    if (statusArray.length === 0) {
      return res.status(400).json({ error: 'Invalid statuses' });
    }
    
    // Tính toán phân trang
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    const offset = (parsedPage - 1) * parsedLimit;
    
    const queryText = `
      SELECT p.*, u.Username
      FROM Posts p
      JOIN Users u ON p.UserID = u.UserID
      WHERE p.Status = ANY($1::text[])
      ORDER BY p.CreatedAtDate DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) 
      FROM Posts
      WHERE Status = ANY($1::text[])
    `;
    
    // Thực hiện truy vấn
    const [postsResult, countResult] = await Promise.all([
      pool.query(queryText, [statusArray, parsedLimit, offset]),
      pool.query(countQuery, [statusArray]),
    ]);
    
    const totalPosts = parseInt(countResult.rows[0].count);
    
    if (postsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No posts found' });
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        posts: postsResult.rows,
        pagination: {
          currentPage: parsedPage,
          totalPages: Math.ceil(totalPosts / parsedLimit),
          totalPosts,
          limit: parsedLimit,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching posts by status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//2) API liên quan đến markdown
// API endpoint để lấy chi tiết bài viết
app.get('/api/article/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        console.log('Yêu cầu slug:', slug);

        // Truy vấn metadata từ bảng Posts
        const postResult = await pool.query(`
            SELECT p.postid, p.title, p.createdatdate AS timestamp, p.status, p.slug,
                   u.username AS author,
                   c.categoryname AS category,
                   sc.subcategoryname AS subcategory
            FROM Posts p
            LEFT JOIN Users u ON p.userid = u.userid
            LEFT JOIN Categories c ON p.categoryid = c.categoryid
            LEFT JOIN SubCategories sc ON p.subcategoryid = sc.subcategoryid
            WHERE p.slug = $1 AND p.status = 'Published'
        `, [slug]);

        if (postResult.rows.length === 0) {
            console.log('Không tìm thấy bài viết với slug:', slug);
            return res.status(404).json({ error: 'Bài viết không tồn tại' });
        }

        const post = postResult.rows[0];
        console.log('Metadata bài viết:', post);

        // Đọc file Markdown
        const filePath = path.join(__dirname, 'posts', `${slug}.md`);
        console.log('Đường dẫn file:', filePath);
        let htmlContent;
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            console.log('Nội dung file (100 ký tự đầu):', fileContent.substring(0, 100));
            const { content } = matter(fileContent);
            htmlContent = marked.parse(content); // Sử dụng marked.parse cho phiên bản mới
        } catch (err) {
            console.error('Lỗi đọc file:', err.message);
            htmlContent = 'Nội dung không khả dụng';
        }

        // Tạo đối tượng trả về
        const article = {
            metadata: {
                postId: post.postid,
                title: post.title,
                author: post.author,
                categories: [post.category, post.subcategory].filter(Boolean),
                timestamp: post.timestamp.toLocaleString('vi-VN'),
                status: post.status,
                slug: post.slug
            },
            body: htmlContent
        };

        // Trả về JSON
        res.json(article);
    } catch (err) {
        console.error('Lỗi server:', err.message);
        res.status(500).json({ error: 'Lỗi server' });
    }
});
//3) API liên quan đến quản lý tag
// Tạo một tag mới
app.post('/api/tags', async (req, res) => {
  const { TagName } = req.body;

  // Kiểm tra xem TagName có được cung cấp và hợp lệ
  if (!TagName || typeof TagName !== 'string' || TagName.trim() === '') {
      return res.status(400).json({ error: 'TagName is required and must be a non-empty string' });
  }

  try {
      // Thêm tag mới vào bảng Tags
      const result = await pool.query(
          'INSERT INTO Tags (TagName) VALUES ($1) RETURNING TagID, TagName',
          [TagName.trim()]
      );

      res.status(201).json({
          message: 'Tag created successfully',
          tag: result.rows[0]
      });
  } catch (error) {
      // Xử lý lỗi trùng lặp TagName (do constraint UNIQUE)
      if (error.code === '23505') {
          return res.status(400).json({ error: 'TagName already exists' });
      }
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});
// Lấy danh sách của tất cả các tag
app.get('/api/tags', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM Tags';
    let params = [];

    if (search) {
      query += ' WHERE TagName ILIKE $1';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY TagName ASC';
    
    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Gắn tags vào posts
app.post('/api/posts/:postId/tags', async (req, res) => {
  const { postId } = req.params;
  const { tagId, postId: bodyPostId } = req.body; // Lấy tagId và postId từ body

  // Kiểm tra postId trong params
  const postIdNum = Number(postId);
  if (isNaN(postIdNum) || postIdNum <= 0) {
      return res.status(400).json({ error: 'postId must be a valid positive number' });
  }

  // Kiểm tra postId trong body có khớp với params không
  if (bodyPostId && Number(bodyPostId) !== postIdNum) {
      return res.status(400).json({ error: 'postId in body does not match postId in URL' });
  }

  // Kiểm tra tagId là mảng và không rỗng
  if (!Array.isArray(tagId) || tagId.length === 0) {
      return res.status(400).json({ error: 'tagId must be a non-empty array' });
  }

  // Kiểm tra tất cả tagId là số hợp lệ
  const invalidTagIds = tagId.filter(id => isNaN(id) || id <= 0);
  if (invalidTagIds.length > 0) {
      return res.status(400).json({ error: 'All tagIds must be valid positive numbers' });
  }

  try {
      // Kiểm tra xem PostID có tồn tại
      const postCheck = await pool.query('SELECT 1 FROM Posts WHERE PostID = $1', [postIdNum]);
      if (postCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Post not found' });
      }

      // Kiểm tra xem tất cả TagID có tồn tại
      const tagCheck = await pool.query(
          'SELECT TagID FROM Tags WHERE TagID = ANY($1)',
          [tagId]
      );
      if (tagCheck.rows.length !== tagId.length) {
          return res.status(400).json({ error: 'One or more tags not found' });
      }

      // Gắn tags vào post
      const values = tagId.map(tagId => `(${postIdNum}, ${tagId})`).join(',');
      await pool.query(
          `INSERT INTO PostTags (PostID, TagID) VALUES ${values} 
           ON CONFLICT (PostID, TagID) DO NOTHING`
      );

      // Lấy danh sách tag hiện tại của post
      const result = await pool.query(
          `SELECT t.TagID, t.TagName 
           FROM PostTags pt 
           JOIN Tags t ON pt.TagID = t.TagID 
           WHERE pt.PostID = $1`,
          [postIdNum]
      );

      res.status(201).json({
          message: 'Tags added to post successfully',
          postId: postIdNum,
          tags: result.rows
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});
// Liệt kê posts và các tags tương ứng 
app.get('/api/posts/tags', async (req, res) => {
  try {
      const result = await pool.query(`
          SELECT 
              p.PostID,
              COALESCE(
                  ARRAY_AGG(t.TagName) FILTER (WHERE t.TagName IS NOT NULL), 
                  '{}'
              ) as Tags
          FROM Posts p
          LEFT JOIN PostTags pt ON p.PostID = pt.PostID
          LEFT JOIN Tags t ON pt.TagID = t.TagID
          GROUP BY p.PostID
          ORDER BY p.PostID
      `);

      res.json(result.rows);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});
// Xóa tags khỏi post
app.delete('/api/posts/:postId/tags', async (req, res) => {
  const { postId } = req.params;
  const { tagIds } = req.body; // Mảng các TagID cần xóa

  // Kiểm tra postId trong params
  const postIdNum = Number(postId);
  if (isNaN(postIdNum) || postIdNum <= 0) {
      return res.status(400).json({ error: 'postId must be a valid positive number' });
  }

  // Kiểm tra tagIds là mảng và không rỗng
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
      return res.status(400).json({ error: 'tagIds must be a non-empty array' });
  }

  // Kiểm tra tất cả tagIds là số hợp lệupdate users set role='NguoiDung' where username='testuser1'
  const invalidTagIds = tagIds.filter(id => isNaN(id) || id <= 0);
  if (invalidTagIds.length > 0) {
      return res.status(400).json({ error: 'All tagIds must be valid positive numbers' });
  }

  try {
      // Kiểm tra xem PostID có tồn tại
      const postCheck = await pool.query('SELECT 1 FROM Posts WHERE PostID = $1', [postIdNum]);
      if (postCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Post not found' });
      }

      // Kiểm tra xem tất cả TagID có tồn tại
      const tagCheck = await pool.query(
          'SELECT TagID FROM Tags WHERE TagID = ANY($1)',
          [tagIds]
      );
      if (tagCheck.rows.length !== tagIds.length) {
          return res.status(400).json({ error: 'One or more tags not found' });
      }

      // Xóa các tags khỏi post
      const deleteResult = await pool.query(
          `DELETE FROM PostTags 
           WHERE PostID = $1 AND TagID = ANY($2) 
           RETURNING TagID`,
          [postIdNum, tagIds]
      );

      // Lấy danh sách tag hiện tại của post sau khi xóa
      const remainingTags = await pool.query(
          `SELECT t.TagID, t.TagName 
           FROM PostTags pt 
           JOIN Tags t ON pt.TagID = t.TagID 
           WHERE pt.PostID = $1`,
          [postIdNum]
      );

      res.status(200).json({
          message: 'Tags removed from post successfully',
          postId: postIdNum,
          removedTagIds: deleteResult.rows.map(row => row.TagID),
          remainingTags: remainingTags.rows
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

//3) API liên quan đến quản lý media

// Tải ảnh lên cho posts
app.post('/api/posts/:postId/media', upload.single('image'), async (req, res) => {
  const { postId } = req.params;

  const postIdNum = Number(postId);
  if (isNaN(postIdNum) || postIdNum <= 0) {
      return res.status(400).json({ error: 'postId must be a valid positive number' });
  }

  if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
  }

  try {
      // Kiểm tra xem PostID có tồn tại
      const postCheck = await pool.query('SELECT 1 FROM Posts WHERE PostID = $1', [postIdNum]);
      if (postCheck.rowCount === 0) {
          // Xóa tệp đã upload nếu post không tồn tại
          await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
          return res.status(404).json({ error: 'Post not found' });
      }

      // Xác định loại MIME của tệp
      const fileType = await fileTypeFromFile(req.file.path);
      const mediaType = fileType ? fileType.mime : req.file.mimetype;

      // Tạo MediaURL (đường dẫn tương đối)
      const mediaUrl = `/uploads/${req.file.filename}`;

      // Lưu metadata vào bảng Media
      const result = await pool.query(
          `INSERT INTO Media (PostID, MediaURL, MediaType) 
           VALUES ($1, $2, $3) 
           RETURNING MediaID, PostID, MediaURL, MediaType, CreatedAtDate`,
          [postIdNum, mediaUrl, mediaType]
      );

      res.status(201).json({
          message: 'Image uploaded successfully',
          media: result.rows[0]
      });
  } catch (error) {
      // Xóa tệp đã upload nếu có lỗi
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Xem tất cả các media có trong hệ thống
app.get('/api/media', async (req, res) => {
  const { postId } = req.query;

  try {
      let query = `
          SELECT 
              MediaID,
              PostID,
              MediaURL,
              MediaType,
              CreatedAtDate
          FROM Media
      `;
      let queryParams = [];
      let conditions = [];

      // Lọc theo postId nếu có
      if (postId) {
          const postIdNum = Number(postId);
          if (isNaN(postIdNum) || postIdNum <= 0) {
              return res.status(400).json({ error: 'postId must be a valid positive number' });
          }
          conditions.push(`PostID = $${queryParams.length + 1}`);
          queryParams.push(postIdNum);
      }

      // Thêm điều kiện WHERE nếu có
      if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(' AND ')}`;
      }

      // Sắp xếp theo CreatedAtDate giảm dần
      query += ` ORDER BY CreatedAtDate DESC`;

      const result = await pool.query(query, queryParams);

      res.status(200).json({
          message: 'Media retrieved successfully',
          media: result.rows
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Xóa ảnh
app.delete('/api/media/:mediaId', async (req, res) => {
  const { mediaId } = req.params;

  const mediaIdNum = Number(mediaId);
  if (isNaN(mediaIdNum) || mediaIdNum <= 0) {
      return res.status(400).json({ error: 'mediaId must be a valid positive number' });
  }

  try {
      // Lấy thông tin media trước khi xóa
      const mediaCheck = await pool.query(
          `SELECT MediaURL 
           FROM Media 
           WHERE MediaID = $1`,
          [mediaIdNum]
      );

      if (mediaCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Media not found' });
      }

      const mediaUrl = mediaCheck.rows[0].MediaURL;

      // Xóa bản ghi trong bảng Media
      await pool.query(
          `DELETE FROM Media 
           WHERE MediaID = $1`,
          [mediaIdNum]
      );

      // Kiểm tra mediaUrl trước khi xóa tệp
      if (typeof mediaUrl === 'string' && mediaUrl.trim() !== '') {
          const filePath = path.join(__dirname, 'public', mediaUrl);
          await fs.unlink(filePath).catch(err => {
              console.error(`Error deleting file: ${err}`);
              // Không trả về lỗi nếu tệp không tồn tại
          });
      } else {
          console.warn(`Warning: MediaURL is invalid or empty for MediaID ${mediaIdNum}`);
      }

      res.status(200).json({
          message: 'Image deleted successfully',
          mediaId: mediaIdNum
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// 5) API liên quan đến quản lý banner các subcategories
// API: Cập nhật banner cho Category
app.post('/api/categories/:categoryId/banner', upload.single('banner'), handleMulterError, async (req, res) => {
  const { categoryId } = req.params;

  const categoryIdNum = Number(categoryId);
  if (isNaN(categoryIdNum) || categoryIdNum <= 0) {
      return res.status(400).json({ error: 'categoryId must be a valid positive number' });
  }

  if (!req.file) {
      return res.status(400).json({ error: 'No banner image provided' });
  }

  try {
      // Kiểm tra xem CategoryID có tồn tại
      const categoryCheck = await pool.query(
          'SELECT BannerURL FROM Categories WHERE CategoryID = $1',
          [categoryIdNum]
      );
      if (categoryCheck.rowCount === 0) {
          await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
          return res.status(404).json({ error: 'Category not found' });
      }

      // Xóa banner cũ nếu có
      const oldBannerUrl = categoryCheck.rows[0].BannerURL;
      if (typeof oldBannerUrl === 'string' && oldBannerUrl.trim() !== '') {
          const oldFilePath = path.join(__dirname, 'public', oldBannerUrl);
          await fs.unlink(oldFilePath).catch(err => console.error(`Error deleting old banner: ${err}`));
      }

      // Lưu banner mới
      const fileType = await fileTypeFromFile(req.file.path);
      const bannerUrl = `/uploads/${req.file.filename}`;

      const result = await pool.query(
          `UPDATE Categories 
           SET BannerURL = $1 
           WHERE CategoryID = $2 
           RETURNING CategoryID, CategoryName, BannerURL`,
          [bannerUrl, categoryIdNum]
      );

      res.status(200).json({
          message: 'Banner updated successfully',
          category: result.rows[0]
      });
  } catch (error) {
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// API: Cập nhật banner cho SubCategory
app.post('/api/subcategories/:subCategoryId/banner', upload.single('banner'), handleMulterError, async (req, res) => {
  const { subCategoryId } = req.params;

  const subCategoryIdNum = Number(subCategoryId);
  if (isNaN(subCategoryIdNum) || subCategoryIdNum <= 0) {
      return res.status(400).json({ error: 'subCategoryId must be a valid positive number' });
  }

  if (!req.file) {
      return res.status(400).json({ error: 'No banner image provided' });
  }

  try {
      // Kiểm tra xem SubCategoryID có tồn tại
      const subCategoryCheck = await pool.query(
          'SELECT BannerURL FROM SubCategories WHERE SubCategoryID = $1',
          [subCategoryIdNum]
      );
      if (subCategoryCheck.rowCount === 0) {
          await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
          return res.status(404).json({ error: 'SubCategory not found' });
      }

      // Xóa banner cũ nếu có
      const oldBannerUrl = subCategoryCheck.rows[0].BannerURL;
      if (typeof oldBannerUrl === 'string' && oldBannerUrl.trim() !== '') {
          const oldFilePath = path.join(__dirname, 'public', oldBannerUrl);
          await fs.unlink(oldFilePath).catch(err => console.error(`Error deleting old banner: ${err}`));
      }

      // Lưu banner mới
      const fileType = await fileTypeFromFile(req.file.path);
      const bannerUrl = `/uploads/${req.file.filename}`;

      const result = await pool.query(
          `UPDATE SubCategories 
           SET BannerURL = $1 
           WHERE SubCategoryID = $2 
           RETURNING SubCategoryID, CategoryID, SubCategoryName, BannerURL`,
          [bannerUrl, subCategoryIdNum]
      );

      res.status(200).json({
          message: 'Banner updated successfully',
          subCategory: result.rows[0]
      });
  } catch (error) {
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Liệt kê tất cả categories và subcategories
app.get('/api/categories', async (req, res) => {
  try {
      const categoriesResult = await pool.query(`
          SELECT 
              c.CategoryID,
              c.CategoryName,
              c.BannerURL,
              COALESCE(
                  ARRAY_AGG(
                      JSON_BUILD_OBJECT(
                          'SubCategoryID', sc.SubCategoryID,
                          'CategoryID', sc.CategoryID,
                          'SubCategoryName', sc.SubCategoryName,
                          'BannerURL', sc.BannerURL
                      )
                  ) FILTER (WHERE sc.SubCategoryID IS NOT NULL),
                  '{}'
              ) as subCategories
          FROM Categories c
          LEFT JOIN SubCategories sc ON c.CategoryID = sc.CategoryID
          GROUP BY c.CategoryID, c.CategoryName, c.BannerURL
          ORDER BY c.CategoryID
      `);

      res.status(200).json({
          message: 'Categories and subcategories retrieved successfully',
          categories: categoriesResult.rows
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

//6) API liên quan tới quản lý các comment
// Tạo comment
app.post('/api/comments', async (req, res) => {
  const { postId, userId, content } = req.body;
  try {
      const result = await pool.query(
          'INSERT INTO Comments (PostID, UserID, Content) VALUES ($1, $2, $3) RETURNING *',
          [postId, userId, content]
      );
      res.status(201).json(result.rows[0]);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint để duyệt comments
app.put('/api/comments/:commentId/moderate', async (req, res) => {
  const { commentId } = req.params;
  const { status, moderatorId, moderationNote } = req.body;
  try {
    
    // Cập nhật trạng thái comment
    const result = await pool.query(
      `UPDATE Comments 
       SET Status = $1, 
           ModeratorID = $2, 
           ModerationNote = $3,
           UpdatedAtDate = CURRENT_TIMESTAMP
       WHERE CommentID = $4
       RETURNING *`,
      [status, moderatorId, moderationNote, commentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy bình luận' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Lỗi khi duyệt bình luận:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// API endpoint để lấy lịch sử duyệt comments
app.get('/api/comments/moderation-history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.UserName as Author, m.UserName as Moderator, p.Title as PostTitle
       FROM Comments c
       JOIN Users u ON c.UserID = u.UserID
       JOIN Users m ON c.ModeratorID = m.UserID
       JOIN Posts p ON c.PostID = p.PostID
       WHERE c.Status IS NOT NULL
       ORDER BY c.UpdatedAtDate DESC`
    );
    
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Lỗi khi lấy lịch sử duyệt bình luận:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// Lấy tất cả các comment đang pending
app.get('/api/comments/pending', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.CommentID,
        c.PostID,
        c.UserID,
        c.Content,
        c.CreatedAtDate,
        c.UpdatedAtDate,
        c.Status,
        c.ModeratorID,
        c.ModerationNote,
        u.Username
      FROM Comments c
      JOIN Users u ON c.UserID = u.UserID
      WHERE c.Status = $1
      ORDER BY c.CreatedAtDate DESC;
    `;
    const result = await pool.query(query, ['pending']);
    
    res.status(200).json({
      status: 'success',
      data: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching pending comments:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Đọc tất cả comment của một post
app.get('/api/comments/:postId', async (req, res) => {
  const { postId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM Comments WHERE PostID = $1 AND Status = $2 ORDER BY CreatedAtDate DESC',
      [postId, 'approved']
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching approved comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Cập nhật comment
app.put('/api/comments/:commentId', async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body;
  try {
    const result = await pool.query(
      'UPDATE Comments SET Content = $1, UpdatedAtDate = CURRENT_TIMESTAMP WHERE CommentID = $2 AND Status = $3 RETURNING *',
      [content, commentId, 'approved']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found or not approved' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Xóa comment
app.delete('/api/comments/:commentId', async (req, res) => {
  const { commentId } = req.params;
  try {
      const result = await pool.query(
          'DELETE FROM Comments WHERE CommentID = $1 RETURNING *',
          [commentId]
      );
      if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Comment not found' });
      }
      res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

//7) API liên quan đến quản lý users
// Register API (Send OTP to email)
app.post('/api/register', async (req, res) => {
  const { userName, password, email } = req.body;

  // Validate input
  if (!userName || !password || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
      // Check if email already exists
      const emailCheck = await pool.query('SELECT * FROM Users WHERE Email = $1', [email]);
      if (emailCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Email already registered' });
      }

      // Generate and store OTP
      const otp = generateOTP();
      otpStorage[email] = { otp, expires: Date.now() + 10 * 60 * 1000 }; // OTP valid for 10 minutes

      // Send OTP via email
      const mailOptions = {
          from: 'your_email@gmail.com',
          to: email,
          subject: 'Your OTP for Registration',
          text: `Your OTP is ${otp}. It is valid for 10 minutes.`,
      };

      await transporter.sendMail(mailOptions);

      res.status(200).json({ message: 'OTP sent to email. Please verify to complete registration.' });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify OTP and complete registration
app.post('/api/register/verify', async (req, res) => {
  const { email, otp, userName, password } = req.body;

  // Validate input
  if (!email || !otp || !userName || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
      // Check OTP
      const storedOtp = otpStorage[email];
      if (!storedOtp || storedOtp.otp !== otp || Date.now() > storedOtp.expires) {
          return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Insert user into database with hashed password and plain password
      const result = await pool.query(
          'INSERT INTO Users (UserName, Password, Email, Role, PlainPassword) VALUES ($1, $2, $3, $4, $5) RETURNING UserID, UserName, Email, Role, CreatedAtDate',
          [userName, hashedPassword, email, 'NguoiDung', password]
      );

      // Remove OTP from storage
      delete otpStorage[email];

      // Xóa PlainPassword để bảo mật (tùy chọn)
      await pool.query(
          'UPDATE Users SET PlainPassword = NULL WHERE UserID = $1',
          [result.rows[0].UserID]
      );

      res.status(201).json({
          message: 'User registered successfully',
          user: result.rows[0],
      });
  } catch (error) {
      console.error('Error registering user:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Login API (Compare credentials with database)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
      // Check if user exists
      const result = await pool.query('SELECT * FROM Users WHERE Email = $1', [email]);
      if (result.rows.length === 0) {
          return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];

      // Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
          return res.status(401).json({ error: 'Invalid email or password' });
      }

      res.status(200).json({
          message: 'Login successful',
          user: {
              userId: user.userid,
              userName: user.username,
              email: user.email,
              role: user.role,
              createdAtDate: user.createdatdate,
          },
      });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Liệt kê thông tin tất cả người dùng trong hệ thống
app.get('/api/users', async (req, res) => {
  try {
      const result = await pool.query('SELECT UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate FROM Users');
      res.json({
          success: true,
          data: result.rows
      });
  } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
          success: false,
          message: 'Internal server error'
      });
  }
});
// Lấy thông tin người dùng hiện tại
app.get('/api/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  
  if (isNaN(userId)) {
      return res.status(400).json({
          success: false,
          message: 'Invalid user ID'
      });
  }

  try {
      const result = await pool.query(
          'SELECT UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate FROM Users WHERE UserID = $1',
          [userId]
      );

      if (result.rows.length === 0) {
          return res.status(404).json({
              success: false,
              message: 'User not found'
          });
      }

      res.json({
          success: true,
          data: result.rows[0]
      });
  } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({
          success: false,
          message: 'Internal server error'
      });
  }
});


app.delete('/api/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Validate input
  if (isNaN(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if user exists and get username
      const userCheck = await client.query(
        'SELECT UserID, UserName FROM Users WHERE UserID = $1',
        [userId]
      );
      
      if (userCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      const userName = userCheck.rows[0].UserName;
      
      // Delete user from Users table (this will trigger the revoke_role_on_delete function)
      await client.query(
        'DELETE FROM Users WHERE UserID = $1',
        [userId]
      );
      
      // Now drop the PostgreSQL user/login
      if (userName) {
        try {
          // Check if the PostgreSQL user exists first
          const userExists = await client.query(
            "SELECT 1 FROM pg_roles WHERE rolname = $1",
            [userName]
          );
          
          if (userExists.rows.length > 0) {
            // Drop the user with CASCADE to clean up any owned objects
            await client.query(
              `DROP USER IF EXISTS ${client.escapeIdentifier(userName)} CASCADE`
            );
          }
        } catch (dropError) {
          // Log but don't fail the operation
          console.warn('Warning: Could not drop PostgreSQL user:', dropError);
          // Consider whether to continue or rollback here
        }
      }
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: `User with ID ${userId} deleted successfully`
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
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