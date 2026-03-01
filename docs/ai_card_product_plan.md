# Product Plan: AI Virtual Card Combo

## 1. Ý Tưởng Cốt Lõi (The Core Concept)
Sản phẩm là một "Combo" đóng gói sẵn nhằm trang bị khả năng thanh toán an toàn cho AI Agent của người dùng khác. Combo bao gồm:
- **Thẻ Ảo (Virtual Card)**: Đã được nạp sẵn tiền (Pre-funded) hoặc có hạn mức giới hạn (e.g., $10, $50).
- **Bộ công cụ (MCP Server Toolkit)**: Đóng vai trò là "Vùng đệm an toàn".

**Mục tiêu:** Cho phép AI Agent (như Claude Desktop, AutoGen, CrewAI) của khách hàng có thể tự động mua sắm, trả phí dịch vụ trên mạng mà **AI không bao giờ biết được số thẻ thật (16 chữ số, CVV)**. Điều này ngăn chặn rủi ro AI bị "hack" (prompt injection) hoặc "ngáo" lấy thẻ đi mua lung tung.

## 2. Bài Toán Đóng Gói (Distribution Models)
Làm thế nào để người lạ mua combo về và "cắm" vào AI của họ một cách mượt mà nhất?

### Mô Hình A: The "Blind" Form Filler (Can thiệp Trình duyệt)
Nếu AI của khách hàng đang dùng Browser Automation (ví dụ dùng Puppeteer/Playwright để duyệt web mua hàng):
1. **Khách mua Combo** và nhận được một `License Key`.
2. Khách chạy **MCP Server của chúng ta** dưới dạng một app nhỏ trên máy họ.
3. Khi AI của khách truy cập trang giỏ hàng và đến bước thanh toán, thay vì AI tự gõ thẻ, AI sẽ gọi công cụ của chúng ta: `process_secure_checkout(url_hien_tai)`
4. MCP Server của chúng ta sẽ:
   - Tự động quét màn hình trang web đó để tìm các ô điền thẻ (Credit Card fields).
   - Gọi API về backend của chúng ta để lấy thông tin Thẻ Ảo (dựa vào `License Key`).
   - TỰ ĐỘNG BƠM (inject) số thẻ vào các ô đó bằng script cục bộ và bấm "Thanh toán".
5. Xong xuôi, MCP trả kết quả về cho AI: "Đã thanh toán thành công". 
-> *AI hoàn toàn không có cơ hội nhìn thấy số thẻ.*

### Mô Hình B: The API Proxy (Dành cho mua dịch vụ số)
Nếu AI của khách muốn mua API, mua tên miền, nạp credit SaaS (không qua giao diện web mà qua API):
1. Khách cài MCP Server.
2. MCP Server cung cấp sẵn các công cụ như `buy_digital_service(service_name, amount)`.
3. AI chỉ việc gọi hàm này. MCP sẽ gửi request về Backend của chúng ta. Backend sẽ dùng thẻ ảo để thanh toán với đối tác thứ 3, sau đó trả kết quả/token về cho AI.

## 3. Kiến Trúc Bảo Mật Tối Cao: Tokenized JIT (Just-In-Time) Payment

Đây là quy trình chuẩn mực nhất để phân phối sản phẩm này đi muôn nơi mà không sợ rủi ro bảo mật. 

- **Bước 1: Cấp Token (Không cấp số thẻ)**
  Hệ thống Neobank/Backend của chúng ta trả về một mã token tạm thời (VD: `temp_auth_8892`) thay vì số thẻ thật. Token này có hiệu lực siêu ngắn (VD: 15 phút) và bị khóa cứng với đúng hạn mức/số tiền đã định.
- **Bước 2: Phân phối "Kỹ Năng" (MCP Tool)** 
  Khách hàng cài đặt MCP Server của chúng ta vào AI Agent của họ. Server này cung cấp một hàm thực thi được thiết kế sẵn: `execute_neobank_payment(token, checkout_url)`.
- **Bước 3: AI Ra Lệnh (Blind Execution)**
  AI Agent của khách hàng (Gemini, Claude, AutoGen...) chỉ truy cập được vào token. Nó ra quyết định chốt đơn và gọi hàm: `execute_neobank_payment("temp_auth_8892", "https://shopify-store.com/checkout")`.
- **Bước 4: Thực Thi Tại Local (The Bridge)**
  Kịch bản MCP trên máy khách tiếp nhận lệnh. Nó chạy ngầm để gửi `temp_auth_8892` về Backend đổi lấy số thẻ thật. **Number thẻ chỉ tồn tại trong RAM cục bộ** (tuyệt đối không in ra text log hay console). MCP lập tức dùng Playwright/Puppeteer điền số thẻ bơm vào DOM của website thanh toán.
- **Bước 5: Burn (Hủy Thẻ Nháy Mắt)**
  Ngay sau khi nút "Pay" được nhấn, Token hết hạn vĩnh viễn và bộ nhớ RAM của script cũng được xóa ngay lập tức. Tính năng "Thẻ Dùng 1 Lần" biến mất, rủi ro lộ thẻ bằng 0.

## 4. Hành Động Tiếp Theo
- Xây dựng sơ đồ kiến trúc API cho Backend (Minitable/Supabase) để quản lý luồng cấp Token và đối soát giao dịch.
- Viết thử 1 cái dummy MCP Server có chứa Playwright script để giả lập "Bước 4" (trải nghiệm bơm dữ liệu RAM vào form).
