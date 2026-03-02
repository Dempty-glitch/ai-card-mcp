# Product Plan: AI Virtual Card Combo

## 1. Ý Tưởng Cốt Lõi (The Core Concept)
Sản phẩm là một "Combo" đóng gói sẵn nhằm trang bị khả năng thanh toán an toàn cho AI Agent của người dùng khác. Combo bao gồm:
- **Thẻ Ảo (Virtual Card)**: Đã được nạp sẵn tiền (Pre-funded) hoặc có hạn mức giới hạn (e.g., $10, $50).
- **Bộ công cụ (MCP Server Toolkit)**: Đóng vai trò là "Vùng đệm an toàn".

**Mục tiêu:** Cho phép AI Agent (như Claude Desktop, AutoGen, CrewAI) của khách hàng có thể tự động mua sắm, trả phí dịch vụ trên mạng mà **AI không bao giờ biết được số thẻ thật (16 chữ số, CVV)**. Điều này ngăn chặn rủi ro AI bị "hack" (prompt injection) hoặc "ngáo" lấy thẻ đi mua lung tung.

## 2. Bài Toán Đóng Gói (Distribution Models)
Làm thế nào để người lạ mua combo về và "cắm" vào AI của họ một cách mượt mà nhất? Giải pháp là **Kiến trúc Giao diện Kép (Dual-Interface)**:

### 2.1. Z-ZERO Developer Portal (Giao diện cho Người / Human)
Người dùng (Developer/Operator) sẽ truy cập một **Web Dashboard** chuyên nghiệp để:
1. Đăng nhập qua ví Web3 (MetaMask/Phantom) hoặc Email.
2. Nạp tiền ký quỹ bằng Crypto (USDC/USDT mạng Base/Arbitrum) để tránh rào cản ngân hàng.
3. Tạo "Agent Persona" và nhận về `API_KEY` cùng file cấu hình `mcp_config.json`.
4. Xem lịch sử giao dịch, biểu đồ chi tiêu và tải hóa đơn đối soát.
*(Lưu ý: Không dùng Chatbot làm công cụ quản lý để đảm bảo tính chuyên nghiệp và minh bạch).*

### 2.2. MCP Server Toolkit (Giao diện cho Máy / AI Agent)
Bản thân AI (Claude, AutoGPT) "mù" giao diện web, nó chỉ cần tải bộ công cụ **MCP Server** của chúng ta (kết nối bằng `API_KEY` lấy từ Portal).
- MCP cài trên máy tính/server của khách hàng.
- Khi AI cần mua hạn mức Cloud hoặc API, nó gọi MCP: `request_payment_token()`.
- MCP tự động gọi backend của bạn, lấy token, chạy ngầm Playwright để bơm vào thẻ Giỏ hàng.

### 2.3. Lớp Trừu Tượng Đối Tác (Issuer Abstraction Layer)
**Bảo mật Kinh doanh (Trade Secret):** Toàn bộ việc hệ thống dùng một đối tác ngân hàng (Neobank Partner) sẽ được giấu kín hoàn toàn ở Backend của hệ thống Z-ZERO.
- Web Dashboard và MCP của khách hàng chỉ gọi API nội bộ của Z-ZERO.
- Khách hàng không bao giờ biết Z-ZERO đang gọi API của đối tác để khởi tạo thẻ thực tế. Điều này chống việc bị copy mô hình kinh doanh.

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
