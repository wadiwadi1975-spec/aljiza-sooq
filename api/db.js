let _idSeq = 100;
function nextId() { return ++_idSeq; }

const db = {
  businesses: [
    { id: 1, name: 'مطعم البيت الدمشقي', nameEn: 'Damascus House Restaurant', category: 'food', phone: '01001234567', whatsapp: '01001234567', address: 'شارع الهرم، الجيزة', addressEn: 'Haram St, Giza', description: 'أشهى المأكولات الشامية والمشويات على الفحم', descriptionEn: 'Tasty levantine dishes & charcoal grills', image: '', featured: true, rating: 4.8, createdAt: new Date().toISOString() },
    { id: 2, name: 'صيدلية الشفاء', nameEn: 'Al-Shifa Pharmacy', category: 'health', phone: '01007654321', whatsapp: '01007654321', address: 'ميدان الجيزة', addressEn: 'Giza Square', description: 'توصيل الأدوية للمنازل على مدار الساعة', descriptionEn: '24/7 home medicine delivery', image: '', featured: true, rating: 4.9, createdAt: new Date().toISOString() },
    { id: 3, name: 'ورشة النور لصيانة السيارات', nameEn: 'Al-Noor Car Service', category: 'cars', phone: '01009876543', whatsapp: '01009876543', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'صيانة شاملة وكشف كمبيوتر وقطع غيار أصلية', descriptionEn: 'Full service, computer check & original parts', image: '', featured: true, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 4, name: 'سنتر النخبة التعليمي', nameEn: 'Elite Learning Center', category: 'education', phone: '01001112233', whatsapp: '01001112233', address: 'الدقي، الجيزة', addressEn: 'Dokki, Giza', description: 'دروس تقوية لجميع المراحل ونخبة من المدرسين', descriptionEn: 'Tutoring for all grades by elite teachers', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 5, name: 'معرض الأناقة للأزياء', nameEn: 'Elegance Fashion Store', category: 'fashion', phone: '01003334455', whatsapp: '01003334455', address: 'المهندسين، الجيزة', addressEn: 'Mohandessin, Giza', description: 'أحدث صيحات الموضة بأسعار منافسة', descriptionEn: 'Latest fashion trends at fair prices', image: '', featured: false, rating: 4.5, createdAt: new Date().toISOString() },
    { id: 6, name: 'شركة الأهرام للعقارات', nameEn: 'Al-Ahram Real Estate', category: 'realestate', phone: '01005556677', whatsapp: '01005556677', address: '6 أكتوبر، الجيزة', addressEn: '6th October, Giza', description: 'شقق وفيلات للبيع والإيجار في كل الجيزة', descriptionEn: 'Flats & villas for sale and rent across Giza', image: '', featured: true, rating: 4.8, createdAt: new Date().toISOString() }
  ],
  inquiries: [
    { id: 1, businessId: 1, name: 'زائر تجريبي', phone: '01000000000', message: 'هل يوجد توصيل للمهندسين؟', createdAt: new Date().toISOString(), read: false }
  ]
};

module.exports = { db, nextId };
