const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { fileTypeFromBuffer } = require('file-type');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const PgSessionStore = require('connect-pg-simple')(session);
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sanitizeHtml = require('sanitize-html');

const app = express();
const port = 3000; // Cổng server
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Middleware
app.use(cors({
  origin: 'http://localhost:3001', // Replace with your frontend URL
  credentials: true // Allow cookies
}));
app.use(express.json()); // Parse JSON body
app.use(cookieParser()); // Required to parse cookies

// Cấu hình kết nối PostgreSQL 
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres', // username
    password: '1234', // password
    database: 'newspaper_db' // current database
});
// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
      user: 'kingdomofhellborn123@gmail.com',
      pass: 'ehporfkkzfyxivao', // Use app-specific password for Gmail
  },
});
// Temporary OTP storage
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

//Handling session
// Session middleware configuration
app.use(
  session({
    store: new PgSessionStore({
      pool: pool, // Use the existing PostgreSQL pool
      tableName: 'session', // Table to store sessions
    }),
    secret: 'zgvfYzjGCntGBERTO0YiJy+Cp4lmWbHxLUMIKp86zFu0Q/JHnSvHfk8hBs4nzGml', // Replace with a secure secret key
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true, // Prevent client-side access to cookies
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    },
  })
);

// Handling categories
const validateCategory = (req, res, next) => {
  const { CategoryName } = req.body;
  if (!CategoryName || typeof CategoryName !== 'string' || CategoryName.trim().length === 0) {
    return res.status(400).json({ error: 'CategoryName is required and must be a non-empty string' });
  }
  if (CategoryName.length > 255) {
    return res.status(400).json({ error: 'CategoryName must not exceed 255 characters' });
  }
  req.body.CategoryName = CategoryName.trim();
  next();
};

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
};


//JWT handling
const authenticateToken = (req, res, next) => {
  const token = req.cookies.authToken; // Get the token from the cookie
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, 'bdaa0bdba4d98131e7c699e78a8c0104dcd767d3789f0adbdd7cc580eff4fc9d'); // Verify the token
    req.user = decoded; // Attach the decoded user data to the request
    next();
  } catch (err) {
    console.error('Error verifying token:', err);
    return res.status(403).json({ error: 'Unauthorized: Invalid token' });
  }
};

//Calculating relative time
const getRelativeTime = (date) => {
  const now = new Date();
  const postDate = new Date(date);
  const diffInMinutes = Math.floor((now - postDate) / (1000 * 60));
  
  if (diffInMinutes < 1) {
    return 'Vừa xong';
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}' trước`;
  } else if (diffInMinutes < 24 * 60) {
    const hours = Math.floor(diffInMinutes / 60);
    return `${hours}h trước`;
  } else {
    const days = Math.floor(diffInMinutes / (60 * 24));
    return `${days} ngày trước`;
  }
};

app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({ message: 'This is a protected route', user: req.user });
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

//Xem chi tiết 1 post
app.get('/api/post/:postID', async (req, res) => {
  const { postID } = req.params;
  try {
    const query = `
      SELECT 
        p.PostID,
        p.Title,
        p.Content,
        p.CreatedAtDate,
        p.Status,
        p.Featured,
        u.UserName AS Author,
        c.CategoryName,
        sc.SubCategoryName,
        m.MediaURL AS ImageURL
      FROM Posts p
      INNER JOIN Users u ON p.UserID = u.UserID
      LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
      LEFT JOIN SubCategories sc ON p.SubCategoryID = sc.SubCategoryID
      LEFT JOIN Media m ON p.PostID = m.PostID
      WHERE p.PostID = $1;
    `;
    const result = await pool.query(query, [postID]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = result.rows[0];
    res.status(200).json({
      postID: post.postid,
      title: post.title,
      content: post.content, // Nội dung dạng HTML từ CKEditor
      author: post.author,
      timestamp: new Date(post.createdatdate).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Ho_Chi_Minh',
      }) + ' (GMT+7)',
      categories: [post.categoryname, post.subcategoryname].filter(Boolean),
      imageUrl: post.imageurl ? `${post.imageurl}` : null,
      status: post.status,
      featured: post.featured,
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Internal Server Error' });
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

//Cập nhật bài viết
app.put('/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { userid, categoryid, subcategoryid, title, content, status, featured } = req.body;

  // Validate PostID
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'Invalid Post ID' });
  }

  // Basic validation
  if (!userid || !title || !content) {
    return res.status(400).json({ error: 'UserID, Title, and Content are required' });
  }

  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 255) {
    return res.status(400).json({ error: 'Title must be a non-empty string with max 255 characters' });
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content must be a non-empty string' });
  }

  // Sanitize content to prevent XSS
  const sanitizedContent = sanitizeHtml(content, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  });

  // Validate status if provided
  const validStatuses = ['Draft', 'Published', 'Archived'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  // Validate featured if provided
  if (featured !== undefined && typeof featured !== 'boolean') {
    return res.status(400).json({ error: 'Featured must be a boolean' });
  }

  try {
    // Check if UserID exists
    const userCheck = await pool.query('SELECT 1 FROM Users WHERE UserID = $1', [userid]);
    if (userCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid UserID: User does not exist' });
    }

    // Check CategoryID (if provided)
    if (categoryid) {
      const categoryCheck = await pool.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [categoryid]);
      if (categoryCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid CategoryID: Category does not exist' });
      }
    }

    // Check SubCategoryID (if provided)
    if (subcategoryid) {
      const subCategoryCheck = await pool.query('SELECT 1 FROM SubCategories WHERE SubCategoryID = $1', [subcategoryid]);
      if (subCategoryCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid SubCategoryID: SubCategory does not exist' });
      }
    }

    // Fetch existing post to preserve fields if not provided
    const existingPost = await pool.query('SELECT Status, Featured FROM Posts WHERE PostID = $1', [id]);
    if (existingPost.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const finalStatus = status || existingPost.rows[0].Status;
    const finalFeatured = featured !== undefined ? featured : existingPost.rows[0].Featured;

    // Update post
    const result = await pool.query(
      `UPDATE Posts
       SET UserID = $1, CategoryID = $2, SubCategoryID = $3, Title = $4, Content = $5, Status = $6, Featured = $7, UpdatedAtDate = CURRENT_TIMESTAMP
       WHERE PostID = $8
       RETURNING PostID AS id, UserID AS userid, CategoryID AS categoryid, SubCategoryID AS subcategoryid, Title AS title, Content AS content, Status AS status, Featured AS featured, CreatedAtDate AS createdatdate, UpdatedAtDate AS updatedatdate`,
      [userid, categoryid || null, subcategoryid || null, title, sanitizedContent, finalStatus, finalFeatured, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating post:', error.message, error.stack);
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Foreign key constraint violation' });
    } else if (error.code === '23502') {
      return res.status(400).json({ error: 'Required field is missing' });
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
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
      SELECT 
        p.PostID,
        p.Title,
        LEFT(p.Content, 200) AS Excerpt,
        m.MediaURL AS ImageURL,
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
    `;
    const result = await pool.query(query);

    // Format the response to match the Article component's props
    const formattedPosts = result.rows.map((post) => ({
      postID: post.postid, // Thêm postID
      categories: [post.categoryname].filter(Boolean),
      title: post.title,
      author: post.author,
      timestamp: new Date(post.createdatdate).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Ho_Chi_Minh',
      }) + ' (GMT+7)',
      excerpt: post.excerpt,
      imageUrl: post.imageurl ? `${post.imageurl}` : null,
    }));

    res.status(200).json(formattedPosts);
  } catch (error) {
    console.error('Error fetching featured posts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// lấy 4 bài viết nổi bật nhất của một category 
app.get('/api/featured-posts/category/:categoryId', async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const query = `
      SELECT 
        p.PostID, 
        p.Title,
        (SELECT m.MediaURL FROM Media m 
        WHERE m.PostID = p.PostID 
        ORDER BY m.CreatedAtDate DESC LIMIT 1) as imageUrl
      FROM Posts p
      WHERE p.CategoryID = $1 AND p.Featured = true AND p.Status = 'Published'
      ORDER BY p.CreatedAtDate DESC
      LIMIT 4;
    `;
    const result = await pool.query(query, [categoryId]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching featured posts by category:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/featured-posts1/category/:categoryId', async (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const query = `
      SELECT 
        p.PostID,
        p.Title,
        p.Content,
        (SELECT m.MediaURL FROM Media m 
         WHERE m.PostID = p.PostID 
         ORDER BY m.CreatedAtDate DESC LIMIT 1) as imageUrl,
        CONCAT('./posts/post', p.PostID, '.html') as link,
        c.CategoryName as category,
        sc.SubCategoryName as subcategory,
        u.UserName as author,
        p.CreatedAtDate as timestamp,
        SUBSTRING(p.Content FROM 1 FOR 150) as excerpt
      FROM Posts p
      LEFT JOIN Users u ON p.UserID = u.UserID
      LEFT JOIN Categories c ON p.CategoryID = c.CategoryID
      LEFT JOIN SubCategories sc ON p.SubCategoryID = sc.SubCategoryID
      WHERE p.CategoryID = $1 AND p.Featured = true AND p.Status = 'Published'
      ORDER BY p.CreatedAtDate DESC
      LIMIT 4;
    `;
    const result = await pool.query(query, [categoryId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No featured posts found' });
    }

    const formattedRows = result.rows.map(row => {
      let timestamp = row.timestamp;
      if (!timestamp || isNaN(Date.parse(timestamp))) {
        console.warn(`Invalid timestamp for PostID ${row.postid}: ${timestamp}, using current date as fallback`);
        timestamp = new Date().toISOString();
      }

      return {
        postid: row.postid,
        imageurl: row.imageurl,
        categories: [row.category, row.subcategory].filter(Boolean),
        title: row.title,
        author: row.author,
        timestamp: new Date(timestamp).toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Ho_Chi_Minh',
        }) + ' (GMT+7)',
        excerpt: row.excerpt || (row.content ? row.content.substring(0, 150) + (row.content.length > 150 ? '...' : '') : 'No excerpt available'),
        link: row.link,
      };
    });

    res.status(200).json({ success: true, data: formattedRows });
  } catch (error) {
    console.error('Error fetching featured posts by category:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Lấy 5 bài viết mới nhất 
app.get('/api/latest-posts', async (req, res) => {
  try {
    const baseUrl = 'http://localhost:3000';
    
    const result = await pool.query(`
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
         ORDER BY m.CreatedAtDate ASC LIMIT 1) as imageUrl
      FROM
        Posts p
      LEFT JOIN
        Users u ON p.UserID = u.UserID
      WHERE
        p.Status = 'Published'
      ORDER BY
        p.CreatedAtDate DESC
      LIMIT 5
    `);
    
    const posts = result.rows.map((post, index) => ({
      postId: post.postid,
      timestamp: getRelativeTime(post.createdatdate),
      title: post.title,
      excerpt: post.content.substring(0, 150) + (post.content.length > 150 ? '...' : ''),
      author: post.authorname || 'AUTHOR',
      imageUrl: post.imageurl 
        ? `${baseUrl}/${post.imageurl.replace(/^\/+/, '')}` // Remove leading slashes if any
        : `https://placehold.co/220x132?text=Post${post.postid}`,
      isLast: index === result.rows.length - 1 // Mark the last item
    }));
    
    res.json(posts);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Lấy 5 bài viết được tạo gần đây nhất ở trạng thái Published (cho dashboard)
app.get('/api/dashboard-featured-posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.PostID,
        p.Title,
        p.CreatedAtDate,
        COALESCE(u.UserName, 'Unknown') AS Author
      FROM
        Posts p
      LEFT JOIN
        Users u ON p.UserID = u.UserID
      WHERE
        p.Status = 'Published'
      ORDER BY
        p.CreatedAtDate DESC
      LIMIT 5
    `);

    const posts = result.rows.map(post => ({
      PostID: post.postid,
      Title: post.title,
      Author: post.author,
      CreatedAtDate: post.createdatdate.toISOString(),
    }));

    res.status(200).json(posts);
  } catch (error) {
    console.error('Error fetching featured posts:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Lấy 4 bài viết được tạo gần đây nhất theo một subcategory
app.get('/api/posts/subcategory/:subcategoryId/recent', async (req, res) => {
  try {
    const subcategoryId = req.params.subcategoryId;

    const query = `
      SELECT 
          p.PostID, 
          p.Title, 
          (SELECT m.MediaURL 
          FROM Media m 
          WHERE m.PostID = p.PostID 
          AND m.MediaType LIKE 'image%' 
          ORDER BY m.CreatedAtDate ASC 
          LIMIT 1) AS imageurl
      FROM Posts p
      WHERE p.SubCategoryID = $1
      AND p.Status = 'Published'
      ORDER BY p.CreatedAtDate DESC
      LIMIT 4;
    `;

    const result = await pool.query(query, [subcategoryId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No posts found in this subcategory' });
    }

    // Map the results to include postID
    const posts = result.rows.map(post => ({
      postid: post.postid, // Thêm postID vào response
      imageurl: post.imageurl,
      title: post.title
    }));

    res.status(200).json({ success: true, data: posts });
  } catch (error) {
    console.error('Error fetching recent posts by subcategory:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

//API để lấy toàn bộ bài viết thuộc một SubCategory ở trạng thái Published
app.get('/posts/subcategory/:subCategoryID', async (req, res) => {
  try {
      const { subCategoryID } = req.params;

      const query = `
          SELECT 
              p.*,
              m.MediaURL
          FROM Posts p
          LEFT JOIN Media m ON p.PostID = m.PostID
          WHERE p.SubCategoryID = $1 AND p.Status = 'Published'
          ORDER BY p.CreatedAtDate DESC;
      `;

      const { rows } = await pool.query(query, [subCategoryID]);

      res.json(rows);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Lỗi khi lấy bài viết' });
  }
});

// API để lấy 3 bài viết cùng chuyên mục
app.get('/api/related-posts/:postId', async (req, res) => {
  const { postId } = req.params;
  
  try {
      const postQuery = `
          SELECT CategoryID 
          FROM Posts 
          WHERE PostID = $1
      `;
      const postResult = await pool.query(postQuery, [postId]);
      
      if (postResult.rows.length === 0) {
          return res.status(404).json({ error: 'Bài viết không tồn tại' });
      }
      
      const categoryId = postResult.rows[0].categoryid;
      
      const relatedQuery = `
          SELECT 
              p.PostID, 
              p.Title,
              m.MediaURL as ImageURL
          FROM Posts p
          LEFT JOIN Media m ON p.PostID = m.PostID 
          WHERE p.CategoryID = $1 
          AND p.PostID != $2 
          AND p.Status = 'Published'
          ORDER BY p.CreatedAtDate DESC
          LIMIT 3
      `;
      const relatedResult = await pool.query(relatedQuery, [categoryId, postId]);
      
      const posts = relatedResult.rows.map(post => ({
          postid: post.postid,
          imageurl: `http://localhost:3000${post.imageurl}`,
          title: post.title
      }));
      
      res.json({
          success: true,
          data: posts
      });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Lỗi server' });
  }
});

//Có thể bạn quan tâm
app.get('/api/posts/:postId/related', async (req, res) => {
  try {
    const { postId } = req.params;
    
    // Kiểm tra xem bài đăng có tồn tại không
    const postExists = await pool.query(
      'SELECT EXISTS(SELECT 1 FROM Posts WHERE PostID = $1)',
      [postId]
    );
    
    if (!postExists.rows[0].exists) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy bài đăng với ID được chỉ định'
      });
    }

    // Truy vấn để lấy các tags của bài đăng
    const postTagsQuery = await pool.query(
      'SELECT TagID FROM PostTags WHERE PostID = $1',
      [postId]
    );

    // Nếu bài đăng không có tags nào
    if (postTagsQuery.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Chuyển đổi mảng các tags thành dạng phù hợp cho câu truy vấn IN
    const tagIds = postTagsQuery.rows.map(row => row.tagid);

    // Truy vấn lấy 3 bài đăng gần nhất có chứa ít nhất một trong các tags của bài gốc
    // nhưng không phải là bài gốc
    const relatedPostsQuery = await pool.query(`
      SELECT DISTINCT p.PostID AS postid, m.MediaURL AS imageurl, p.Title AS title
      FROM Posts p
      JOIN PostTags pt ON p.PostID = pt.PostID
      JOIN Media m ON p.PostID = m.PostID
      WHERE pt.TagID IN (${tagIds.join(',')})
      AND p.PostID != $1
      ORDER BY p.PostID DESC
      LIMIT 3;
    `, [postId]);

    return res.status(200).json({
      success: true,
      data: relatedPostsQuery.rows
    });
  } catch (error) {
    console.error('Lỗi khi lấy bài đăng liên quan:', error);
    return res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi khi xử lý yêu cầu'
    });
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
      SELECT 
          p.PostID, 
          p.UserID, 
          p.CategoryID, 
          p.SubCategoryID, 
          p.Title, 
          p.Content, 
          p.CreatedAtDate, 
          p.UpdatedAtDate, 
          p.Status, 
          p.Featured, 
          m.MediaURL AS ImageUrl
      FROM Posts p
      LEFT JOIN Media m ON p.PostID = m.PostID
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
      posts: result.rows.map(post => ({
        ...post,
        link: `/article/${post.PostID}`, // Thêm link động
      })),
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

//3) API liên quan đến quản lý tag
// Get all tags
app.get('/api/tags', async (req, res) => {
  try {
    const query = `
      SELECT TagID, TagName
      FROM Tags
      ORDER BY TagName
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/tags', async (req, res) => {
  const { TagName, PostID } = req.body;

  if (!TagName) {
    return res.status(400).json({ error: 'TagName is required' });
  }

  try {
    // Check if tag already exists
    const tagCheckQuery = `
      SELECT TagID 
      FROM Tags 
      WHERE TagName = $1
    `;
    const tagCheckResult = await pool.query(tagCheckQuery, [TagName]);

    let tagId;

    if (tagCheckResult.rows.length > 0) {
      return res.status(400).json({ error: 'Tag already exists' });
    }

    // Create new tag
    const tagInsertQuery = `
      INSERT INTO Tags (TagName)
      VALUES ($1)
      RETURNING TagID, TagName
    `;
    const tagInsertResult = await pool.query(tagInsertQuery, [TagName]);
    tagId = tagInsertResult.rows[0].tagid;

    // Optionally associate with a post
    if (PostID) {
      // Verify post exists
      const postCheckQuery = `
        SELECT PostID 
        FROM Posts 
        WHERE PostID = $1
      `;
      const postCheckResult = await pool.query(postCheckQuery, [PostID]);

      if (postCheckResult.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Check if association already exists
      const assocCheckQuery = `
        SELECT 1 
        FROM PostTags 
        WHERE PostID = $1 AND TagID = $2
      `;
      const assocCheckResult = await pool.query(assocCheckQuery, [PostID, tagId]);

      if (assocCheckResult.rows.length === 0) {
        // Create association
        const assocInsertQuery = `
          INSERT INTO PostTags (PostID, TagID)
          VALUES ($1, $2)
        `;
        await pool.query(assocInsertQuery, [PostID, tagId]);
      }
    }

    res.json({
      success: true,
      data: { TagID: tagId, TagName },
      message: PostID ? 'Tag created and associated with post' : 'Tag created'
    });
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Associate a tag with multiple posts
app.post('/api/tags/:tagId/posts', async (req, res) => {
  const { tagId } = req.params;
  const { PostIDs } = req.body;

  if (!Array.isArray(PostIDs) || PostIDs.length === 0) {
    return res.status(400).json({ error: 'PostIDs array is required' });
  }

  try {
    // Verify tag exists
    const tagCheckQuery = `
      SELECT TagID 
      FROM Tags 
      WHERE TagID = $1
    `;
    const tagCheckResult = await pool.query(tagCheckQuery, [tagId]);

    if (tagCheckResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Verify all posts exist
    const postCheckQuery = `
      SELECT PostID 
      FROM Posts 
      WHERE PostID = ANY($1)
    `;
    const postCheckResult = await pool.query(postCheckQuery, [PostIDs]);

    if (postCheckResult.rows.length !== PostIDs.length) {
      return res.status(404).json({ error: 'One or more posts not found' });
    }

    // Associate tag with each post
    const assocInsertQuery = `
      INSERT INTO PostTags (PostID, TagID)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `;
    for (const postId of PostIDs) {
      await pool.query(assocInsertQuery, [postId, tagId]);
    }

    res.json({
      success: true,
      message: `Tag associated with ${PostIDs.length} post(s)`
    });
  } catch (error) {
    console.error('Error associating tag with posts:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET tất cả PostTags
app.get('/api/posttags', async (req, res) => {
  try {
    const query = `
      SELECT pt.postid, pt.tagid, p.title AS posttitle, t.tagname 
      FROM posttags pt
      JOIN posts p ON pt.postid = p.postid
      JOIN tags t ON pt.tagid = t.tagid
      ORDER BY pt.tagid, pt.postid
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching PostTags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PostTags'
    });
  }
});

// DELETE một liên kết PostTag
app.delete('/api/posttags/:postId/:tagId', async (req, res) => {
  try {
    const { postId, tagId } = req.params;
    
    const query = 'DELETE FROM posttags WHERE postid = $1 AND tagid = $2';
    const result = await pool.query(query, [postId, tagId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'PostTag association not found'
      });
    }
    
    res.json({
      success: true,
      message: 'PostTag association deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting PostTag:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete PostTag association'
    });
  }
});

//3) API liên quan đến quản lý media

// Tải ảnh lên
app.post('/api/media', upload.single('image'), async (req, res) => {
  if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
  }

  try {
      console.log('File path:', req.file.path);
      console.log('fileTypeFromBuffer:', typeof fileTypeFromBuffer);

      // Check if file exists
      const exists = await fs.access(req.file.path).then(() => true).catch(() => false);
      if (!exists) {
          throw new Error('Uploaded file not found');
      }

      // Read file into buffer
      const buffer = await fs.readFile(req.file.path);

      // Determine MIME type
      const fileType = await fileTypeFromBuffer(buffer);
      const mediaType = fileType ? fileType.mime : req.file.mimetype;

      // Create MediaURL (relative path)
      const mediaUrl = `/uploads/${req.file.filename}`;

      // Save metadata to Media table
      const result = await pool.query(
          `INSERT INTO Media (MediaURL, MediaType) 
           VALUES ($1, $2) 
           RETURNING MediaID, MediaURL, MediaType, CreatedAtDate`,
          [mediaUrl, mediaType]
      );

      res.status(201).json({
          message: 'Image uploaded successfully',
          media: result.rows[0]
      });
  } catch (error) {
      // Delete uploaded file if error occurs
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      console.error('Error:', error);
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

//Cập nhật PostID cho mỗi ảnh
app.put('/api/media/:mediaID', async (req, res) => {
  const { mediaID } = req.params;
  const { postID } = req.body;

  if (!postID) {
      return res.status(400).json({ error: 'postID is required' });
  }

  try {
      const query = `
          UPDATE Media
          SET PostID = $1
          WHERE MediaID = $2
          RETURNING *;
      `;

      const result = await pool.query(query, [postID, mediaID]);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Media not found' });
      }

      res.status(200).json({ message: 'PostID updated successfully', media: result.rows[0] });
  } catch (error) {
      console.error('Error updating PostID:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


// 5) API liên quan đến các subcategories và categories
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
    // Check if CategoryID exists
    const categoryCheck = await pool.query(
      'SELECT BannerURL FROM Categories WHERE CategoryID = $1',
      [categoryIdNum]
    );
    if (categoryCheck.rowCount === 0) {
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      return res.status(404).json({ error: 'Category not found' });
    }

    // Delete old banner if it exists
    const oldBannerUrl = categoryCheck.rows[0].BannerURL;
    if (typeof oldBannerUrl === 'string' && oldBannerUrl.trim() !== '') {
      const oldFilePath = path.join(__dirname, 'public', oldBannerUrl);
      await fs.unlink(oldFilePath).catch(err => console.error(`Error deleting old banner: ${err}`));
    }

    // Validate file type using fileTypeFromBuffer
    const fileBuffer = await fs.readFile(req.file.path);
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType || !['image/jpeg', 'image/png', 'image/gif'].includes(fileType.mime)) {
      await fs.unlink(req.file.path).catch(err => console.error(`Error deleting file: ${err}`));
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and GIF are allowed.' });
    }

    // Save new banner
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

// Liệt kê tất cả categories
app.get('/api/categories', async (req, res) => {
  try {
    // Query to get all categories
    const categoriesResult = await pool.query(`
      SELECT
        CategoryID,
        CategoryName,
        BannerURL
      FROM Categories
      ORDER BY CategoryID
    `);
    
    res.status(200).json({
      message: 'All categories retrieved successfully',
      categories: categoriesResult.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Thêm một categories mới
app.post('/api/categories', validateCategory, async (req, res) => {
  const { CategoryName } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO Categories (CategoryName) VALUES ($1) RETURNING CategoryID, CategoryName',
      [CategoryName]
    );
    res.status(201).json({
      message: 'Category created successfully',
      category: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'CategoryName already exists' });
    }
    console.error('Error creating category:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Sửa một categories theo id
app.put('/api/categories/:id', validateCategory, async (req, res) => {
  const { CategoryName } = req.body;
  const categoryId = parseInt(req.params.id, 10);

  if (isNaN(categoryId)) {
    return res.status(400).json({ error: 'Invalid CategoryID' });
  }

  try {
    const result = await pool.query(
      'UPDATE Categories SET CategoryName = $1 WHERE CategoryID = $2 RETURNING CategoryID, CategoryName',
      [CategoryName, categoryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      message: 'Category updated successfully',
      category: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'CategoryName already exists' });
    }
    console.error('Error updating category:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Xóa categories
app.delete('/api/categories/:id', async (req, res) => {
  const categoryId = parseInt(req.params.id, 10);

  if (isNaN(categoryId)) {
    return res.status(400).json({ error: 'Invalid CategoryID' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM Categories WHERE CategoryID = $1 RETURNING CategoryID, CategoryName',
      [categoryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({
      message: 'Category deleted successfully',
      category: result.rows[0],
    });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Liệt kê tất cả các sub-categories
app.get('/api/subcategories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sc.*, c.CategoryName 
      FROM SubCategories sc
      LEFT JOIN Categories c ON sc.CategoryID = c.CategoryID
      ORDER BY sc.SubCategoryID
    `);
    
    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Lỗi khi lấy danh sách sub-categories:', error);
    res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi khi lấy danh sách sub-categories',
      error: error.message
    });
  }
});

// Tạo sub-categories
app.post('/api/subcategories', async (req, res) => {
  try {
    const { CategoryID, SubCategoryName, BannerURL } = req.body;
    
    if (!SubCategoryName) {
      return res.status(400).json({
        success: false,
        message: 'SubCategoryName là trường bắt buộc'
      });
    }
    
    // Kiểm tra xem CategoryID có tồn tại không (nếu được cung cấp)
    if (CategoryID) {
      const categoryExists = await pool.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [CategoryID]);
      if (categoryExists.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'CategoryID không tồn tại'
        });
      }
    }
    
    // Kiểm tra xem SubCategoryName đã tồn tại chưa trong CategoryID này
    const duplicateCheck = await pool.query(
      'SELECT 1 FROM SubCategories WHERE CategoryID = $1 AND SubCategoryName = $2',
      [CategoryID, SubCategoryName]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'SubCategoryName đã tồn tại trong Category này'
      });
    }
    
    // Thêm sub-category mới
    const result = await pool.query(
      'INSERT INTO SubCategories (CategoryID, SubCategoryName, BannerURL) VALUES ($1, $2, $3) RETURNING *',
      [CategoryID, SubCategoryName, BannerURL]
    );
    
    res.status(201).json({
      success: true,
      message: 'Đã tạo sub-category mới thành công',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Lỗi khi tạo sub-category mới:', error);
    res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi khi tạo sub-category mới',
      error: error.message
    });
  }
});

//Cập nhật sub-categories
app.put('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { CategoryID, SubCategoryName, BannerURL } = req.body;
    
    // Kiểm tra xem sub-category có tồn tại không
    const subCategoryExists = await pool.query('SELECT * FROM SubCategories WHERE SubCategoryID = $1', [id]);
    
    if (subCategoryExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy sub-category với ID này'
      });
    }
    
    // Kiểm tra xem CategoryID có tồn tại không (nếu được cung cấp)
    if (CategoryID) {
      const categoryExists = await pool.query('SELECT 1 FROM Categories WHERE CategoryID = $1', [CategoryID]);
      if (categoryExists.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'CategoryID không tồn tại'
        });
      }
    }
    
    // Kiểm tra xem SubCategoryName mới đã tồn tại chưa trong CategoryID này
    if (CategoryID && SubCategoryName) {
      const duplicateCheck = await pool.query(
        'SELECT 1 FROM SubCategories WHERE CategoryID = $1 AND SubCategoryName = $2 AND SubCategoryID != $3',
        [CategoryID, SubCategoryName, id]
      );
      
      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'SubCategoryName đã tồn tại trong Category này'
        });
      }
    }
    
    // Cập nhật thông tin sub-category
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (CategoryID !== undefined) {
      updateFields.push(`CategoryID = $${paramCount}`);
      values.push(CategoryID);
      paramCount++;
    }
    
    if (SubCategoryName !== undefined) {
      updateFields.push(`SubCategoryName = $${paramCount}`);
      values.push(SubCategoryName);
      paramCount++;
    }
    
    if (BannerURL !== undefined) {
      updateFields.push(`BannerURL = $${paramCount}`);
      values.push(BannerURL);
      paramCount++;
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không có thông tin nào được cập nhật'
      });
    }
    
    values.push(id);
    const updateQuery = `
      UPDATE SubCategories 
      SET ${updateFields.join(', ')} 
      WHERE SubCategoryID = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, values);
    
    res.status(200).json({
      success: true,
      message: 'Đã cập nhật sub-category thành công',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Lỗi khi cập nhật sub-category:', error);
    res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi khi cập nhật sub-category',
      error: error.message
    });
  }
});

//Xóa sub-categories
app.delete('/api/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Kiểm tra xem sub-category có tồn tại không
    const subCategoryExists = await pool.query('SELECT 1 FROM SubCategories WHERE SubCategoryID = $1', [id]);
    
    if (subCategoryExists.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy sub-category với ID này'
      });
    }
    
    // Xóa sub-category
    await pool.query('DELETE FROM SubCategories WHERE SubCategoryID = $1', [id]);
    
    res.status(200).json({
      success: true,
      message: 'Đã xóa sub-category thành công'
    });
  } catch (error) {
    console.error('Lỗi khi xóa sub-category:', error);
    res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi khi xóa sub-category',
      error: error.message
    });
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
      `SELECT c.*, u.UserName as author, m.UserName as Moderator, p.Title as PostTitle
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
// API: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Check if user exists
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.userid, username: user.username, email: user.email },
      'bdaa0bdba4d98131e7c699e78a8c0104dcd767d3789f0adbdd7cc580eff4fc9d', // Replace with your secret key (store in environment variable)
    );

    // Set the JWT token in an HTTP-only cookie
    res.cookie('authToken', token, {
      httpOnly: true, // Prevents client-side JavaScript from accessing the cookie
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
      maxAge: 3600000, // 1 hour in milliseconds (matches token expiration)
      sameSite: 'strict' // Protects against CSRF attacks
    });

    // Send success response
    res.json({
      message: 'Login successful',
      user: { id: user.userid, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// API: Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('authToken'); // Clear the authToken cookie
  res.json({ message: 'Logout successful' });
});

// API: Check authentication status
app.get('/api/check-auth', authenticateToken, (req, res) => {
  // If the middleware passes, the token is valid, and req.user contains the decoded user data
  res.json({
    isAuthenticated: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      email: req.user.email,
    },
  });
});

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
          [userName, hashedPassword, email, 'nguoidung', password]
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
          'SELECT UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate, AvatarURL FROM Users WHERE UserID = $1',
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

// Cập nhật role của user
app.put('/api/users/:userId/role', async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;

  // Danh sách các role hợp lệ
  const validRoles = ['admin', 'nguoidung', 'author'];

  try {
    // Kiểm tra role hợp lệ
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role. Valid roles are: ' + validRoles.join(', ')
      });
    }

    // Cập nhật role trong database
    const result = await pool.query(
      'UPDATE Users SET Role = $1 WHERE UserID = $2 RETURNING UserID, UserName, Role',
      [role, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Role updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Đồng bộ đăng nhập tài khoản với thông tin trong bảng
app.patch('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  const { username, password } = req.body;

  try {
      // Validate input
      if (!username && !password) {
          return res.status(400).json({ error: 'At least one of username or password must be provided' });
      }

      // Prepare update fields
      const updates = {};
      if (username) updates.UserName = username;
      if (password) {
          updates.PlainPassword = password;
          updates.Password = await bcrypt.hash(password, 10); // Hash password with bcrypt
      }
      updates.UpdatedAtDate = new Date();

      // Build dynamic SQL query
      const fields = Object.keys(updates).map((key, index) => `${key} = $${index + 1}`);
      const values = Object.values(updates);

      if (fields.length === 0) {
          return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Update user in database
      const query = `
          UPDATE Users
          SET ${fields.join(', ')}
          WHERE UserID = $${fields.length + 1}
          RETURNING UserID, UserName, Role, Email, CreatedAtDate, UpdatedAtDate
      `;
      const result = await pool.query(query, [...values, userId]);

      if (result.rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
      }

      // Return updated user (excluding Password and PlainPassword)
      res.json(result.rows[0]);
  } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// API upload avatar
app.post('/api/upload-avatar/:userId', upload.single('avatar'), async (req, res) => {
  try {
      const { userId } = req.params;
      const avatarUrl = `/uploads/${req.file.filename}`;

      const updateQuery = `
          UPDATE Users 
          SET AvatarURL = $1, UpdatedAtDate = CURRENT_TIMESTAMP
          WHERE UserID = $2
          RETURNING AvatarURL
      `;
      
      const result = await pool.query(updateQuery, [avatarUrl, userId]);
      
      if (result.rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
      }

      res.json({
          message: 'Avatar uploaded successfully',
          avatarUrl: result.rows[0].AvatarURL
      });
  } catch (error) {
      console.error('Error uploading avatar:', error);
      res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

//8) API liên quan đến thống kê 
app.get('/api/statistics', async (req, res) => {
  try {
    // Truy vấn số lượng bài đăng
    const postsResult = await pool.query('SELECT COUNT(*) AS total_posts FROM Posts');
    const totalPosts = parseInt(postsResult.rows[0].total_posts);

    // Truy vấn số lượng bình luận
    const commentsResult = await pool.query('SELECT COUNT(*) AS total_comments FROM Comments');
    const totalComments = parseInt(commentsResult.rows[0].total_comments);

    // Truy vấn số lượng tài khoản
    const usersResult = await pool.query('SELECT COUNT(*) AS total_users FROM Users');
    const totalUsers = parseInt(usersResult.rows[0].total_users);

    // Trả về kết quả thống kê
    return res.status(200).json({
      success: true,
      data: {
        totalPosts,
        totalComments,
        totalUsers
      }
    });
  } catch (error) {
    console.error('Lỗi khi lấy thống kê:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy thống kê',
      error: error.message
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